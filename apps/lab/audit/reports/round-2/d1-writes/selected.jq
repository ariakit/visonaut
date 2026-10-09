.[] | . as $d | ($sel[0][$d.id] // "OPEN") as $s
| "\n=== \($d.id) -> \($s) | \($d.short)\nQ: \($d.question)\nCTX: \($d.context)\nEVID: \($d.evidence|join(" "))\n"
  + ([$d.options[] | select(.id == $s or $s=="OPEN") | "  - \(.id): \(.label)\n      EXPL: \(.explanation)\n      CONS: \(.consequences)"] | join("\n"))
  + "\n  OTHER OPTIONS: " + ([$d.options[] | select(.id != $s) | .id] | join(", "))
