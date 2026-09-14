import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SettingsSkill } from '../shared/types'
export interface SkillRoot { path: string; source: string }
const meta = (text:string, key:string) => new RegExp(`^${key}:\\s*(.+)$`, 'mi').exec(text)?.[1]?.trim()
export function discoverSkills(roots: SkillRoot[]): SettingsSkill[] {
 const out: SettingsSkill[]=[]
 for(const root of roots){ let names:string[]=[]; try{names=readdirSync(root.path)}catch{continue}
  for(const name of names.sort()){const dir=join(root.path,name); try{if(!statSync(dir).isDirectory())continue}catch{continue}; const file=join(dir,'SKILL.md'); let text; try{text=readFileSync(file,'utf8')}catch{continue}
   const id=meta(text,'id')||name; const title=meta(text,'name')||/^#\s+(.+)$/m.exec(text)?.[1]?.trim()||name; const description=meta(text,'description')||text.split(/\n\s*\n/)[1]?.replace(/\s+/g,' ').trim().slice(0,240)||''
   out.push({id:`${root.source}:${id}`,name:title,description,source:root.source,path:relative(root.path,dir),enabled:true})
  }
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id))
}
