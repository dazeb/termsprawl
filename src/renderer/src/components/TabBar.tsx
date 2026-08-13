import { useProjects } from '../state/projects'

// Project tabs — the app's window chrome drag region.
export function TabBar(): React.JSX.Element {
  const projects = useProjects((s) => s.projects)
  const activeProjectId = useProjects((s) => s.activeProjectId)
  const select = useProjects((s) => s.select)
  const create = useProjects((s) => s.create)

  const openProjects = projects.filter((p) => !p.closed)

  const newProject = async (): Promise<void> => {
    const name = `project-${openProjects.length + 1}`
    await create(name, null)
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
