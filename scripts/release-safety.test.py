"""Offline release failure-path checks: python3 scripts/release-safety.test.py.

Everything here runs without network, builds, or publishing. The checks either
drive the small release helper scripts against temp directories, or extract a
step body from the Gitea workflow / release.sh and execute it in a temp repo.
The canonical gate runner (scripts/verify.sh, called by `pnpm run verify`) runs
this file before the vitest suite.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]

# The canonical gate order. It is load-bearing: the Server Edition boot gate
# test asserts the built renderer shell, so both builds must precede the suite.
GATES = [
    'pnpm run typecheck',
    'pnpm run build',
    'pnpm run build:server',
    'python3 scripts/release-safety.test.py',
    'pnpm test',
]


def read(rel):
    return (ROOT / rel).read_text()


def workflow_step(name):
    """Return the run body of a named step in .gitea/workflows/ci.yml."""
    workflow = read('.gitea/workflows/ci.yml')
    block = workflow.split(f'      - name: {name}\n', 1)[1].split('      - name:', 1)[0]
    if 'run: |\n' in block:
        return textwrap.dedent(block.split('run: |\n', 1)[1])
    return block.split('run: ', 1)[1].strip()


def strip_comments(text):
    """Drop whole-line comments so ordering checks see executable lines only."""
    import re
    return re.sub(r'(?m)^\s*#.*$', '', text)


def assert_ordered(case, text, tokens, label):
    cursor = -1
    for token in tokens:
        at = text.find(token)
        case.assertGreater(at, -1, f'{label}: missing {token}')
        case.assertGreater(at, cursor, f'{label}: {token} is out of order')
        cursor = at


def write_stub(directory, name, body):
    path = Path(directory) / name
    path.write_text(body)
    path.chmod(0o755)


def git_init(directory):
    def git(*args, check=True):
        return subprocess.run(['git', *args], cwd=directory, check=check, capture_output=True)
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Release test')
    git('commit', '--allow-empty', '-m', 'first')
    return git


class ReleaseSafety(unittest.TestCase):
    def test_existing_tags_are_reused_only_at_head(self):
        script = read('scripts/release.sh')
        block = script[script.index('if git rev-parse --verify "refs/tags/$TAG"'):script.index('git push origin "$TAG"')]
        with tempfile.TemporaryDirectory() as directory:
            git = git_init(directory)
            for _ in range(2):
                result = subprocess.run(['bash', '-euc', 'TAG=v1.2.3\n' + block], cwd=directory, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            git('commit', '--allow-empty', '-m', 'second')
            result = subprocess.run(['bash', '-euc', 'TAG=v1.2.3\n' + block], cwd=directory, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'different commit', result.stderr)

    def test_new_tags_are_annotated_and_same_commit_reuse_is_preserved(self):
        script = read('scripts/release.sh')
        self.assertIn('git tag -a "$TAG" -m', script)
        block = script[script.index('if git rev-parse --verify "refs/tags/$TAG"'):script.index('git push origin "$TAG"')]
        with tempfile.TemporaryDirectory() as directory:
            git = git_init(directory)
            run = lambda: subprocess.run(['bash', '-euc', 'TAG=v1.2.3\n' + block], cwd=directory, capture_output=True)
            first = run()
            self.assertEqual(first.returncode, 0, first.stderr)
            # An annotated tag is a real tag object, not a bare commit pointer.
            self.assertEqual(git('cat-file', '-t', 'v1.2.3').stdout.strip(), b'tag')
            message = git('tag', '-l', '--format=%(contents:subject)', 'v1.2.3').stdout.strip()
            self.assertTrue(message, 'annotated tag has no message')
            tag_object = git('rev-parse', 'v1.2.3').stdout.strip()
            second = run()
            self.assertEqual(second.returncode, 0, second.stderr)
            # Same-commit reuse: the tag object is left exactly as it was.
            self.assertEqual(git('rev-parse', 'v1.2.3').stdout.strip(), tag_object)
            self.assertIn(b'reusing existing', second.stdout)

    def test_originality_screen_is_strict_on_the_release_path(self):
        """A skip must not be a pass for a release: strict mode fails loudly."""
        script = read('scripts/release.sh')
        gates = script[script.index('# ---- 3. gates ----'):script.index('# ---- 4.')]
        self.assertIn('TS_REQUIRE_PRIOR=1 ./scripts/check-originality.sh', gates)
        # The plain invocation is still what CONTRIBUTING tells contributors to
        # run, so only the release path becomes strict.
        self.assertIn('./scripts/check-originality.sh', read('CONTRIBUTING.md'))

        checker = str(ROOT / 'scripts/check-originality.py')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'src'
            source.mkdir()
            (source / 'app.ts').write_text('const answer = 42\n')
            missing_prior = str(Path(directory) / 'no-such-prior-project')

            # Default: the prior tree is legitimately absent (fresh clone, CI),
            # so a warning + exit 0 is the intended behaviour.
            default = subprocess.run(
                ['python3', checker, str(source), missing_prior], capture_output=True)
            self.assertEqual(default.returncode, 0, default.stderr)
            self.assertIn(b'WARN: prior project not found', default.stdout)

            # Strict: the same missing tree is a hard failure — the release
            # script cannot pass the clean-room gate vacuously.
            for value in ('1', 'yes', 'true'):
                strict = subprocess.run(
                    ['python3', checker, str(source), missing_prior],
                    env={**os.environ, 'TS_REQUIRE_PRIOR': value}, capture_output=True)
                self.assertNotEqual(strict.returncode, 0, 'strict mode accepted a missing prior tree')
                self.assertIn(b'FAIL: prior project not found', strict.stdout)

            # An explicit opt-out value keeps the non-strict behaviour.
            opt_out = subprocess.run(
                ['python3', checker, str(source), missing_prior],
                env={**os.environ, 'TS_REQUIRE_PRIOR': '0'}, capture_output=True)
            self.assertEqual(opt_out.returncode, 0, opt_out.stderr)

            # Strict mode does not change the result when the prior tree IS
            # present — a real comparison still runs to its normal verdict.
            prior = Path(directory) / 'prior'
            prior.mkdir()
            (prior / 'old.ts').write_text('\n'.join(
                f'const copiedLine{i} = "value number {i}"' for i in range(6)) + '\n')
            honest = Path(directory) / 'honest-src'
            honest.mkdir()
            (honest / 'own.ts').write_text('const fresh = "written from scratch"\n')
            strict = subprocess.run(
                ['python3', checker, str(honest), str(prior)],
                env={**os.environ, 'TS_REQUIRE_PRIOR': '1'}, capture_output=True)
            self.assertEqual(strict.returncode, 0, strict.stdout + strict.stderr)
            self.assertIn(b'OK: no copied blocks found', strict.stdout)

            # And it still catches a real copy, strictly or not.
            (honest / 'lifted.ts').write_text('\n'.join(
                f'const copiedLine{i} = "value number {i}"' for i in range(6)) + '\n')
            caught = subprocess.run(
                ['python3', checker, str(honest), str(prior)],
                env={**os.environ, 'TS_REQUIRE_PRIOR': '1'}, capture_output=True)
            self.assertNotEqual(caught.returncode, 0)
            self.assertIn(b'SUSPICIOUS', caught.stdout)

    def test_github_token_is_required(self):
        command = workflow_step('require GitHub publishing credentials')
        for token, succeeds in [('', False), ('test-token', True)]:
            result = subprocess.run(['bash', '-c', command], env={**os.environ, 'GH_TOKEN': token}, capture_output=True)
            self.assertEqual(result.returncode == 0, succeeds)

    def test_artifact_gate_rejects_missing_or_empty_files(self):
        block = workflow_step('verify release artifacts')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'package.json').write_text('{"version":"1.2.3"}')
            (root / 'dist').mkdir()
            files = [root / 'dist' / name for name in ['termsprawl-1.2.3.AppImage', 'termsprawl_1.2.3_amd64.deb', 'latest-linux.yml', 'SHA256SUMS']]
            for path in files:
                path.write_text('artifact')
            def run():
                return subprocess.run(['bash', '-c', block], cwd=directory, capture_output=True).returncode
            self.assertEqual(run(), 0)
            for path in files:
                path.unlink()
                self.assertNotEqual(run(), 0, f'{path.name} missing was accepted')
                path.touch()
                self.assertNotEqual(run(), 0, f'{path.name} empty was accepted')
                path.write_text('artifact')

    def test_site_resume_and_verification(self):
        for scenario, succeeds in [('ok', True), ('http', False), ('missing', False), ('stale', False), ('suffix', False)]:
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / 'src/lib').mkdir(parents=True)
                (root / 'scripts').mkdir()
                (root / 'bin').mkdir()
                (root / 'src/lib/site.ts').write_text("export const APP_VERSION = '1.2.3'\n")
                (root / 'scripts/deploy-hermes-box.sh').write_text('exit 0\n')
                commands = {
                    'git': '#!/bin/bash\nif [[ "$1" == commit ]]; then exit 99; fi\nexit 0\n',
                    'curl': '''#!/bin/bash
if [[ "$SCENARIO" == http ]]; then exit 22; fi
if [[ "${@: -1}" == https://termsprawl.com/ ]]; then
  if [[ "$SCENARIO" == missing ]]; then echo '<html></html>'; else echo 'assets/index-abc.js'; fi
elif [[ "$SCENARIO" == stale ]]; then echo 'version="1.2.2"';
elif [[ "$SCENARIO" == suffix ]]; then echo 'version="1.2.30"';
else echo 'version="1.2.3"'; fi
''',
                }
                for name, content in commands.items():
                    path = root / 'bin' / name
                    path.write_text(content)
                    path.chmod(0o755)
                env = {**os.environ, 'PATH': str(root / 'bin') + ':' + os.environ['PATH'], 'TERMSPRAWL_WEB': directory, 'SCENARIO': scenario}
                result = subprocess.run(['bash', str(ROOT / 'scripts/release-site.sh'), '1.2.3'], env=env, capture_output=True)
                self.assertEqual(result.returncode == 0, succeeds, result.stdout + result.stderr)
                self.assertEqual(b'DONE: site live' in result.stdout, succeeds)

    def test_verify_script_orders_gates_and_stops_at_first_failure(self):
        package = json.loads(read('package.json'))
        self.assertEqual(package['scripts'].get('verify'), 'bash scripts/verify.sh')
        verify = read('scripts/verify.sh')
        assert_ordered(self, strip_comments(verify), GATES, 'scripts/verify.sh')

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / 'log'
            write_stub(root, 'pnpm', '''#!/bin/bash
printf 'pnpm %s\\n' "$*" >> "$LOG"
if [[ -n "${FAIL_ON:-}" && "$*" == "$FAIL_ON" ]]; then exit 1; fi
exit 0
''')
            write_stub(root, 'python3', '''#!/bin/bash
printf 'python3 %s\\n' "$*" >> "$LOG"
exit 0
''')
            env = {**os.environ, 'PATH': str(root) + os.pathsep + os.environ['PATH'], 'LOG': str(log)}
            result = subprocess.run(['bash', str(ROOT / 'scripts/verify.sh')], env=env, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(
                log.read_text().splitlines(),
                ['pnpm run typecheck', 'pnpm run build', 'pnpm run build:server', 'python3 scripts/release-safety.test.py', 'pnpm test'],
            )

            log.write_text('')
            failed = subprocess.run(['bash', str(ROOT / 'scripts/verify.sh')], env={**env, 'FAIL_ON': 'run build'}, capture_output=True)
            self.assertNotEqual(failed.returncode, 0)
            self.assertEqual(log.read_text().splitlines(), ['pnpm run typecheck', 'pnpm run build'])
            self.assertIn(b'build', failed.stdout + failed.stderr)

    def test_release_and_ci_call_the_canonical_verify_command(self):
        release = read('scripts/release.sh')
        self.assertIn('pnpm run verify', release)
        gates = release[release.index('# ---- 3. gates ----'):release.index('# ---- 4.')]
        self.assertIn('./scripts/check-originality.sh', gates)
        for duplicate in ['pnpm run typecheck', 'pnpm run build', 'python3 scripts/release-safety.test.py', 'pnpm test']:
            self.assertNotIn(duplicate, gates, f'release.sh duplicates the gate list: {duplicate}')

        workflow = read('.gitea/workflows/ci.yml')
        verify_job = workflow.split('  verify:\n', 1)[1].split('  release:\n', 1)[0]
        self.assertIn('pnpm run verify', verify_job)
        self.assertIn('pnpm install --frozen-lockfile', verify_job)
        self.assertIn('pnpm --dir relay install', verify_job)
        for duplicate in ['run: pnpm run typecheck', 'run: pnpm run build', 'run: python3 scripts/release-safety.test.py', 'run: pnpm test']:
            self.assertNotIn(duplicate, verify_job, f'CI verify job duplicates the gate list: {duplicate}')

    def test_release_notes_come_from_changelog(self):
        helper = ROOT / 'scripts/release-notes.mjs'
        self.assertTrue(helper.exists(), 'scripts/release-notes.mjs is missing')
        changelog = textwrap.dedent("""\
            # Changelog

            ## [Unreleased]

            Nothing yet.

            ## [1.2.3] \u2014 2026-02-01

            ### Added

            - Marker entry for the notes test.

            ## [1.2.2] \u2014 2026-01-01

            - Older entry.

            [Unreleased]: https://example.com/compare/v1.2.3...HEAD
            [1.2.3]: https://example.com/compare/v1.2.2...v1.2.3
            """)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'CHANGELOG.md').write_text(changelog)
            result = subprocess.run(['node', str(helper), '1.2.3'], cwd=directory, capture_output=True)
            notes = result.stdout.decode()
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(notes.strip(), 'release notes are empty')
            self.assertIn('Marker entry for the notes test.', notes)
            self.assertNotIn('Older entry.', notes)
            self.assertNotIn('No CHANGELOG.md entry', notes)

            # The oldest section sits directly above the changelog footer:
            # link-reference definitions must not leak into the notes body.
            oldest = subprocess.run(['node', str(helper), '1.2.2'], cwd=directory, capture_output=True)
            self.assertEqual(oldest.returncode, 0, oldest.stderr)
            self.assertIn('Older entry.', oldest.stdout.decode())
            self.assertNotIn('example.com/compare', oldest.stdout.decode())

            # A missing entry gets an explicit, still-nonempty fallback.
            missing = subprocess.run(['node', str(helper), '9.9.9'], cwd=directory, capture_output=True)
            fallback = missing.stdout.decode()
            self.assertEqual(missing.returncode, 0, missing.stderr)
            self.assertTrue(fallback.strip(), 'fallback release notes are empty')
            self.assertIn('No CHANGELOG.md entry', fallback)
            self.assertIn('9.9.9', fallback)

            # A section that exists without a body is malformed, not silent.
            (root / 'CHANGELOG.md').write_text('# Changelog\n\n## [9.9.9] \u2014 2026-02-01\n\n## [9.9.8] \u2014 2026-01-01\n\n- x\n')
            empty = subprocess.run(['node', str(helper), '9.9.9'], cwd=directory, capture_output=True)
            self.assertNotEqual(empty.returncode, 0, 'an empty changelog section was accepted')

    def test_ci_release_notes_step_writes_nonempty_notes(self):
        block = workflow_step('write release notes')
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'scripts/release-notes.mjs').write_bytes((ROOT / 'scripts/release-notes.mjs').read_bytes())
            (root / 'dist').mkdir()
            (root / 'package.json').write_text('{"version":"1.2.3"}')
            (root / 'CHANGELOG.md').write_text('## [1.2.3] \u2014 2026-02-01\n\n- Shipped the thing.\n')
            result = subprocess.run(['bash', '-c', block], cwd=directory, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            notes = (root / 'dist/RELEASE_NOTES.md').read_text()
            self.assertIn('Shipped the thing.', notes)

    def test_release_checksums_gate_and_generation(self):
        helper = ROOT / 'scripts/release-checksums.sh'
        self.assertTrue(helper.exists(), 'scripts/release-checksums.sh is missing')
        artifacts = ['termsprawl-1.2.3.AppImage', 'termsprawl_1.2.3_amd64.deb', 'latest-linux.yml']
        with tempfile.TemporaryDirectory() as directory:
            dist = Path(directory) / 'dist'
            dist.mkdir()
            for name in artifacts:
                (dist / name).write_text('artifact ' + name)
            run = lambda: subprocess.run(['bash', str(helper), str(dist), '1.2.3'], capture_output=True)
            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            sums = dist / 'SHA256SUMS'
            self.assertGreater(sums.stat().st_size, 0)
            first = sums.read_bytes()
            for line in sums.read_text().strip().splitlines():
                digest, name = line.split()
                self.assertEqual(len(digest), 64)
                self.assertIn(name, artifacts)
            check = subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=dist, capture_output=True)
            self.assertEqual(check.returncode, 0, check.stdout + check.stderr)

            # Deterministic: the same inputs produce the same file.
            self.assertEqual(run().returncode, 0)
            self.assertEqual(sums.read_bytes(), first)

            # A tampered artifact no longer matches the published checksums.
            (dist / artifacts[0]).write_text('tampered')
            check = subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=dist, capture_output=True)
            self.assertNotEqual(check.returncode, 0)
            (dist / artifacts[0]).write_text('artifact ' + artifacts[0])

            # Missing or empty primary artifacts are rejected before generation.
            for name in artifacts:
                path = dist / name
                backup = path.read_bytes()
                path.unlink()
                self.assertNotEqual(run().returncode, 0, f'{name} missing was accepted')
                path.write_text('')
                self.assertNotEqual(run().returncode, 0, f'{name} empty was accepted')
                path.write_bytes(backup)

    def test_builder_publishes_checksums_and_notes_to_both_hosts(self):
        workflow = read('.gitea/workflows/ci.yml')
        release_job = workflow.split('  release:\n', 1)[1]
        assert_ordered(
            self,
            release_job,
            ['pnpm run build && pnpm exec electron-builder', 'name: write release notes', 'release-checksums.sh', 'name: verify release artifacts', 'name: publish gitea release', 'name: publish github release'],
            'release job',
        )

        gitea = workflow_step('publish gitea release')
        self.assertIn('dist/SHA256SUMS', gitea)
        self.assertIn('dist/latest-linux.yml', gitea)
        self.assertIn('dist/RELEASE_NOTES.md', gitea)

        github = workflow_step('publish github release')
        self.assertIn('dist/SHA256SUMS', github)
        self.assertIn('dist/latest-linux.yml', github)
        self.assertIn('--notes-file dist/RELEASE_NOTES.md', github)
        # Idempotent retries: create, else edit the notes + re-upload.
        self.assertIn('gh release upload', github)
        self.assertIn('gh release edit', github)
        self.assertIn('--clobber', github)

    def test_local_dist_flow_uploads_checksums_and_notes(self):
        release = read('scripts/release.sh')
        local = release[release.index('if [[ "$LOCAL_DIST" -eq 1 ]]'):]
        self.assertIn('scripts/release-checksums.sh', local)
        self.assertIn('scripts/release-notes.mjs', local)
        self.assertIn('--notes-file', local)
        self.assertIn('SHA256SUMS', local)
        self.assertIn('gh release create', local)
        self.assertIn('gh release edit', local)
        self.assertIn('gh release upload', local)


if __name__ == '__main__':
    unittest.main()
