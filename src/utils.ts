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
