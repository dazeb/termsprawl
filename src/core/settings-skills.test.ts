import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { discoverSkills } from './settings-skills'
describe('discoverSkills',()=>{it('sorts and parses metadata safely',()=>{const d=mkdtempSync(join(tmpdir(),'skills-')); mkdirSync(join(d,'b')); mkdirSync(join(d,'a')); writeFileSync(join(d,'b','SKILL.md'),'# Bee\n\nDesc'); writeFileSync(join(d,'a','SKILL.md'),'bad'); expect(discoverSkills([{path:d,source:'local'}]).map(x=>x.name)).toEqual(['a','Bee'])})})
