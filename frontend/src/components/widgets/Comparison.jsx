import Table from '../ui/Table.jsx'

/* Attributes down, items across.
 *
 * The alignment is the whole value: the reason to render this rather than prose
 * is being able to read one row and see the same fact for every item. A row
 * whose values do not line up with `items` is padded rather than dropped, so a
 * short answer leaves a visible gap instead of silently shifting every cell
 * after it into the wrong column. */

export default function Comparison({ data }) {
  const items = data.items ?? []
  if (!items.length) return null

  return (
    <div className="widget widget-comparison">

      <div className="widget-scroll">
        <Table className="widget-table">
          <Table.Head>
            <th scope="col" />
            {items.map((item, i) => <th scope="col" key={i}>{item}</th>)}
          </Table.Head>
          <Table.Body>
            {(data.attributes ?? []).map((attr, r) => (
              <Table.Row key={r}>
                <th scope="row">{attr.name}</th>
                {items.map((_, c) => (
                  <Table.Cell key={c}>{attr.values?.[c] ?? '—'}</Table.Cell>
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>
    </div>
  )
}
