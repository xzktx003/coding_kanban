/** ICU forms used by the original tool registry: arguments, selectors and numeric plurals. */
export function formatNativeToolMessage(
  template: string,
  values: Record<string, unknown>,
  language: string,
) {
  const number = new Intl.NumberFormat(language);
  const close = (value: string, start: number) => {
    let depth = 1;
    for (let index = start + 1; index < value.length; index++) {
      if (value[index] === "{") depth++;
      else if (value[index] === "}" && !--depth) return index;
    }
    return -1;
  };
  const render = (value: string, plural?: number): string => {
    let result = "";
    for (let index = 0; index < value.length; index++) {
      if (value[index] === "'" && value[index + 1] === "'") {
        result += "'";
        index++;
        continue;
      }
      if (value[index] === "'" && /[{#}]/.test(value[index + 1] ?? "")) {
        const end = value.indexOf("'", index + 1);
        if (end !== -1) {
          result += value.slice(index + 1, end);
          index = end;
          continue;
        }
      }
      if (value[index] === "#" && plural !== undefined) {
        result += number.format(plural);
        continue;
      }
      if (value[index] !== "{") {
        result += value[index];
        continue;
      }
      const end = close(value, index);
      if (end === -1) {
        result += value.slice(index);
        break;
      }
      const content = value.slice(index + 1, end),
        parts = content.match(
          /^\s*([^,]+?)(?:\s*,\s*([^,]+)(?:\s*,\s*([\s\S]*))?)?\s*$/,
        );
      if (!parts) {
        index = end;
        continue;
      }
      const argument = values[parts[1].trim()],
        type = parts[2]?.trim();
      if (type === "select" || type === "plural" || type === "selectordinal") {
        let cases = parts[3] ?? "",
          offset = 0;
        const prefix = cases.match(/^offset:\s*(\d+)\s*/);
        if (prefix) {
          offset = Number(prefix[1]);
          cases = cases.slice(prefix[0].length);
        }
        const branches = new Map<string, string>();
        for (let cursor = 0; cursor < cases.length; ) {
          const match = cases.slice(cursor).match(/^\s*([^\s{]+)\s*\{/);
          if (!match) break;
          const begin = cursor + match[0].length - 1,
            finish = close(cases, begin);
          if (finish === -1) break;
          branches.set(match[1], cases.slice(begin + 1, finish));
          cursor = finish + 1;
        }
        const numeric =
            typeof argument === "number" ? argument : Number(argument),
          key =
            type === "select"
              ? String(argument)
              : branches.has(`=${numeric}`)
                ? `=${numeric}`
                : new Intl.PluralRules(language, {
                    type: type === "selectordinal" ? "ordinal" : "cardinal",
                  }).select(numeric - offset);
        result += render(
          branches.get(key) ?? branches.get("other") ?? "",
          type === "select" ? plural : numeric - offset,
        );
      } else if (type === "number" && typeof argument === "number")
        result += number.format(argument);
      else if (argument !== undefined && argument !== null)
        result += String(argument);
      index = end;
    }
    return result;
  };
  return render(template);
}
