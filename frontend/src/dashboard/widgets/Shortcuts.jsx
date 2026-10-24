export default function Shortcuts({ data }) {
  return <dl className="shortcut-list">{(data?.shortcuts || []).map(([key, label]) => <div key={key}><dt><kbd>{key}</kbd></dt><dd>{label}</dd></div>)}</dl>
}
