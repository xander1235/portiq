const SAFE_EXPRESSION = /^[\w\s+\-*/()."'`]+$/;

export function applyDerivedFields(rows, derivedFields) {
  if (!Array.isArray(rows) || derivedFields.length === 0) return rows;
  return rows.map((row) => {
    const next = { ...row };
    derivedFields.forEach(({ name, expression }) => {
      try {
        next[name] = evaluateExpression(expression, row);
      } catch (err) {
        next[name] = `#ERR`;
      }
    });
    return next;
  });
}

export function evaluateExpression(expression, row) {
  if (!expression || typeof expression !== "string") return "";
  if (!SAFE_EXPRESSION.test(expression)) {
    throw new Error("Expression contains unsupported characters");
  }
  const tokens = expression.split(/\b/).map((token) => {
    if (row && Object.prototype.hasOwnProperty.call(row, token)) {
      return `row[${JSON.stringify(token)}]`;
    }
    return token;
  });
  const compiled = tokens.join("");
  // eslint-disable-next-line no-new-func
  const fn = new Function("row", `return ${compiled}`);
  return fn(row);
}

export function sortRows(rows, sortKey, direction) {
  if (!sortKey) return rows;
  const dir = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aVal = a?.[sortKey];
    const bVal = b?.[sortKey];
    if (aVal === bVal) return 0;
    if (aVal === undefined) return 1;
    if (bVal === undefined) return -1;
    const aNum = Number(aVal);
    const bNum = Number(bVal);
    const bothNumeric = !Number.isNaN(aNum) && !Number.isNaN(bNum);
    if (bothNumeric) {
      return aNum > bNum ? dir : -dir;
    }
    return String(aVal).localeCompare(String(bVal)) * dir;
  });
}

export function filterRows(rows, query, key) {
  if (!query) return rows;
  const lower = query.toLowerCase();
  return rows.filter((row) => {
    if (key) {
      return String(row?.[key] ?? "").toLowerCase().includes(lower);
    }
    return Object.values(row).some((value) => String(value).toLowerCase().includes(lower));
  });
}
