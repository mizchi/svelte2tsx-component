export function toSafeIdentifier(input: string): string {
  if (!input) {
    return "_";
  }

  let result = input[0].match(/[A-Za-z_$]/) ? input[0] : "_";

  for (let i = 1; i < input.length; i++) {
    let char = input[i];

    if (char.match(/[A-Za-z0-9_$]/)) {
      result += char;
    } else {
      result += "_" + char.charCodeAt(0).toString(16) + "_";
    }
  }

  return result;
}

// https://gist.github.com/goldhand/70de06a3bdbdb51565878ad1ee37e92b
export const parseInlineStyle = (styles: string): Record<string, string> =>
  styles
    .split(";")
    .filter((style) => style.split(":")[0] && style.split(":")[1])
    .map((style) => [
      style
        .split(":")[0]
        .trim()
        .replace(/-./g, (c) => c.substring(1).toUpperCase()),
      style.split(":")[1].trim(),
    ])
    .reduce(
      (styleObj, style) => ({
        ...styleObj,
        [style[0]]: style[1],
      }),
      {},
    );
