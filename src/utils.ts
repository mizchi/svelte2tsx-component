export function toSafeIdentifier(input: string): string {
  // 入力が空の場合、デフォルトの識別子を返す
  if (!input) {
    return "_";
  }

  // 最初の文字がアルファベット、アンダースコア、またはドル記号でない場合はアンダースコアで置き換える
  let result = input[0].match(/[A-Za-z_$]/) ? input[0] : "_";

  // 2文字目以降の処理
  for (let i = 1; i < input.length; i++) {
    let char = input[i];

    // 文字がアルファベット、数字、アンダースコア、またはドル記号ならそのまま結合
    if (char.match(/[A-Za-z0-9_$]/)) {
      result += char;
    } else {
      // その他の文字は16進数のコードに変換してアンダースコアで囲む
      // これにより、元の文字の意味がある程度保持される
      result += "_" + char.charCodeAt(0).toString(16) + "_";
    }
  }

  return result;
}
