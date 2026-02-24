export function jsonToXml(obj, indent = 0) {
  const pad = "  ".repeat(indent);
  if (obj === null || obj === undefined) {
    return `${pad}<value/>`;
  }
  if (typeof obj !== "object") {
    return `${pad}<value>${escapeXml(String(obj))}</value>`;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => `${pad}<item>\n${jsonToXml(item, indent + 1)}\n${pad}</item>`).join("\n");
  }
  return Object.entries(obj)
    .map(([key, value]) => {
      if (typeof value === "object" && value !== null) {
        return `${pad}<${key}>\n${jsonToXml(value, indent + 1)}\n${pad}</${key}>`;
      }
      return `${pad}<${key}>${escapeXml(String(value))}</${key}>`;
    })
    .join("\n");
}

export function xmlToJson(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(parseError.textContent || "Invalid XML");
  }
  return xmlNodeToObject(doc.documentElement);
}

export function prettifyXml(xml) {
  let formatted = '';
  let pad = 0;

  // Collapse whitespace between tags
  xml = xml.replace(/>\s+</g, '><');

  // Insert newlines between tags, but NOT inside text nodes
  xml = xml.replace(/(>)(<)(\/*)/g, '$1\r\n$2$3');

  xml.split('\r\n').forEach((node) => {
    let indent = 0;
    if (node.match(/^<\//)) {
      pad -= 1;
    } else if (node.match(/^<[^>]*[^\/]>$/) && !node.match(/^<\?/)) {
      indent = 1;
    }

    formatted += '  '.repeat(Math.max(0, pad)) + node + '\n';
    pad += indent;
  });

  return formatted.trim();
}

export function jsonToCsv(obj) {
  const rows = Array.isArray(obj) ? obj : obj?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    return "";
  }
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );
  const escapeCell = (value) => {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[",\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(",")];
  rows.forEach((row) => {
    lines.push(headers.map((key) => escapeCell(row?.[key])).join(","));
  });
  return lines.join("\n");
}

function xmlNodeToObject(node) {
  const obj = {};
  if (node.attributes && node.attributes.length > 0) {
    obj["@attributes"] = {};
    Array.from(node.attributes).forEach((attr) => {
      obj["@attributes"][attr.name] = attr.value;
    });
  }

  const childNodes = Array.from(node.childNodes).filter(
    (child) => child.nodeType === 1 || (child.nodeType === 3 && child.textContent.trim())
  );

  if (childNodes.length === 1 && childNodes[0].nodeType === 3) {
    return childNodes[0].textContent.trim();
  }

  childNodes.forEach((child) => {
    if (child.nodeType === 3) {
      obj["#text"] = child.textContent.trim();
      return;
    }
    const value = xmlNodeToObject(child);
    if (obj[child.nodeName]) {
      if (!Array.isArray(obj[child.nodeName])) {
        obj[child.nodeName] = [obj[child.nodeName]];
      }
      obj[child.nodeName].push(value);
    } else {
      obj[child.nodeName] = value;
    }
  });

  return obj;
}

function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
