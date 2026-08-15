import { useProjects } from '../state/projects'
import { projectNameFromPath } from '../state/workspace'

// Project tabs — the app's window chrome drag region.
export function TabBar(): React.JSX.Element {
  const projects = useProjects((s) => s.projects)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const select = useProjects((s) => s.select)
  const create = useProjects((s) => s.create)

  const openProjects = projects.filter((p) => !p.closed)

  // A project is tied to a folder: ask the user which one, then name the
  // project after it. Cancel = no project created.
  const newProject = async (): Promise<void> => {
    const cwd = await window.termsprawl.workspace.selectFolder()
    if (!cwd) return
    const name = projectNameFromPath(cwd, `project-${openProjects.length + 1}`)
    await create(name, cwd)
  }

  return (
    <div className="tab-bar">
      {openProjects.map((p) => (
        <button
          key={p.id}
          className={`tab ${p.id === activeProjectId ? 'tab-active' : ''}`}
          onClick={() => select(p.id)}
          title={p.cwd ?? p.name}
        >
          <span className="tab-dot" />
          {p.name}
        </button>
      ))}
      <button className="tab tab-new" onClick={() => void newProject()} title="New project">
        +
      </button>
    </div>
  )
}
