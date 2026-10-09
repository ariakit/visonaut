.cases[]
| select(.name | test("^(A|B|C|D) "))
| "\n## \(.name)  calls=\(.d1Calls) read=\(.rowsRead) WRITTEN=\(.rowsWritten)",
  (.bySql[] | select(.rows_written > 0) | "   x\(.count) written=\(.rows_written) :: \(.sql | gsub("\\s+"; " ") | .[0:230])")
