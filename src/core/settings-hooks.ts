import { existsSync, readFileSync } from 'node:fs'
import type { SettingsHook } from '../shared/types'
export function inventoryHooks(files: Array<{path:string; agent:string; source:'managed'|'legacy'}>): SettingsHook[] {
 const out: SettingsHook[]=[]
 for(const f of files){ if(!existsSync(f.path)) continue; let raw=''; try{raw=readFileSync(f.path,'utf8')}catch{continue}
  for(const event of ['PreToolUse','PostToolUse','Notification','Stop','UserPromptSubmit']) if(raw.includes(event)) out.push({id:`${f.agent}:${event}:${f.source}`,event,agent:f.agent,source:f.source,command:'configured hook',enabled:true})
 }
 return out.sort((a,b)=>a.id.localeCompare(b.id))
}
