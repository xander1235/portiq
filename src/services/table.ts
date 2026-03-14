const SAFE_EXPRESSION = /^[\w\s+\-*/()."'`]+$/;

export function createDerivedError(message: string) {
  return {
    __portiqDerivedError: true,
    message: message || "Derived field evaluation failed"
  };
}

export function isDerivedError(value: any) {
  return Boolean(value && typeof value === "object" && value.__portiqDerivedError);
}

function normalizeValue(value: any) {
  if (isDerivedError(value)) {
    return "#ERR";
  }
  return value;
}

export function applyDerivedFields(rows: any[], derivedFields: any[]) {
  if (!Array.isArray(rows) || derivedFields.length === 0) return rows;
  return rows.map((row) => {
    const next = { ...row };
    derivedFields.forEach(({ name, expression }) => {
      try {
        next[name] = evaluateExpression(expression, row);
      } catch (err: any) {
        next[name] = createDerivedError(err.message);
      }
    });
    return next;
  });
}

export function evaluateExpression(expression: string, row: any) {
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
   
  const fn = new Function("row", `return ${compiled}`);
  return fn(row);
}

export function sortRows(rows: any[], sortKey: string, direction: string) {
  if (!sortKey) return rows;
  const dir = direction === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const aVal = normalizeValue(a?.[sortKey]);
    const bVal = normalizeValue(b?.[sortKey]);
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

export function filterRows(rows: any[], query: string, key?: string) {
  if (!query) return rows;
  const lower = query.toLowerCase();
  return rows.filter((row) => {
    if (key) {
      return String(normalizeValue(row?.[key]) ?? "").toLowerCase().includes(lower);
    }
    return Object.values(row).some((value) => String(normalizeValue(value)).toLowerCase().includes(lower));
  });
}
