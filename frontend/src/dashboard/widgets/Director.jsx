export default function Director({ data }) {
  return <ul className="widget-list">{(data?.items || []).map(item => <li key={item.id}>
    <div><strong>{item.title}</strong><p>{item.detail}</p></div>
  </li>)}</ul>
}
