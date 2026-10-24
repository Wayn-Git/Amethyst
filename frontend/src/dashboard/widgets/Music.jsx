export default function Music({ data }) {
  function row(item, index) { return <li key={`${item.url}-${index}`}><div>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a> : <strong>{item.title}</strong>}<p>{item.artists.join(', ')}{item.played_at && <> · <time dateTime={item.played_at}>{new Date(item.played_at).toLocaleString()}</time></>}</p></div></li> }
  return <div><h3>Currently playing</h3>{data?.items?.length ? <ul className="widget-list">{data.items.map(row)}</ul> : <p>Nothing playing.</p>}<h3>Recently played</h3><ul className="widget-list">{data?.history?.map(row)}</ul></div>
}
