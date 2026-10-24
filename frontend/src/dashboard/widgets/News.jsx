export default function News({ data }) {
  return <div><p>Topics use the tags you assign in the RSS reader.</p>{data?.errors?.length > 0 && <p role="status">Some feeds are unavailable; saved items may be stale. Review sources in the RSS reader.</p>}{data?.items?.map(group => <section key={group.tag} aria-label={group.tag}><h3>{group.tag}</h3><ul className="widget-list">{group.items.map((item, i) => <li key={`${item.feed_id}-${item.url}-${i}`}><div><a href={item.url} target="_blank" rel="noreferrer">{item.title}</a><p>{item.published_at}</p></div></li>)}</ul></section>)}</div>
}
