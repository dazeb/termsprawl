"""Offline release failure-path checks: python3 scripts/release-safety.test.py."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReleaseSafety(unittest.TestCase):
    def test_existing_tags_are_reused_only_at_head(self):
        script = (ROOT / 'scripts/release.sh').read_text()
        block = script[script.index('if git rev-parse --verify "refs/tags/$TAG"'):script.index('git push origin "$TAG"')]
        with tempfile.TemporaryDirectory() as directory:
            def git(*args):
                return subprocess.run(['git', *args], cwd=directory, check=True, capture_output=True)
            git('init')
            git('config', 'user.email', 'test@example.com')
            git('config', 'user.name', 'Release test')
            git('commit', '--allow-empty', '-m', 'first')
            for _ in range(2):
                result = subprocess.run(['bash', '-euc', 'TAG=v1.2.3\n' + block], cwd=directory, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            git('commit', '--allow-empty', '-m', 'second')
            result = subprocess.run(['bash', '-euc', 'TAG=v1.2.3\n' + block], cwd=directory, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'different commit', result.stderr)

    def test_github_token_is_required(self):
        workflow = (ROOT / '.gitea/workflows/ci.yml').read_text()
        step = workflow.split('      - name: require GitHub publishing credentials\n', 1)[1].split('      - name:', 1)[0]
        command = step.split('        run: ', 1)[1].strip()
        for token, succeeds in [('', False), ('test-token', True)]:
            result = subprocess.run(['bash', '-c', command], env={**os.environ, 'GH_TOKEN': token}, capture_output=True)
            self.assertEqual(result.returncode == 0, succeeds)

    def test_artifact_gate_rejects_missing_or_empty_files(self):
        workflow = (ROOT / '.gitea/workflows/ci.yml').read_text()
        block = workflow.split('      - name: verify release artifacts\n', 1)[1].split('      - name:', 1)[0]
        import textwrap
        block = textwrap.dedent(block.split('run: |\n', 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'package.json').write_text('{"version":"1.2.3"}')
            (root / 'dist').mkdir()
            files = [root / 'dist' / name for name in ['termsprawl-1.2.3.AppImage', 'termsprawl_1.2.3_amd64.deb', 'latest-linux.yml']]
            for path in files:
                path.write_text('artifact')
            def run():
                return subprocess.run(['bash', '-c', block], cwd=directory, capture_output=True).returncode
            self.assertEqual(run(), 0)
            for path in files:
                path.unlink()
                self.assertNotEqual(run(), 0)
                path.touch()
                self.assertNotEqual(run(), 0)
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


if __name__ == '__main__':
    unittest.main()
