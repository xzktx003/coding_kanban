export const nativeMarkdownLabels = (language: string) => {
  if (language.startsWith("fr"))
    return {
      copy: "Copier",
      copied: "Copié",
      wrapOn: "Activer le retour à la ligne",
      wrapOff: "Désactiver le retour à la ligne",
      moreCode: "Autres actions du bloc de code",
      downloadCode: "Télécharger le code",
      copyTable: "Copier le tableau",
      scrollTable: "Tableau défilant",
      moreTable: "Autres actions du tableau",
      download: "Télécharger",
      failed: "La copie a échoué",
    };
  if (language.startsWith("ja"))
    return {
      copy: "コピー",
      copied: "コピー済み",
      wrapOn: "折り返しを有効にする",
      wrapOff: "折り返しを無効にする",
      moreCode: "コードブロックのその他の操作",
      downloadCode: "コードをダウンロード",
      copyTable: "表をコピー",
      scrollTable: "横スクロールできる表",
      moreTable: "表のその他の操作",
      download: "ダウンロード",
      failed: "コピーに失敗しました",
    };
  if (language.startsWith("en"))
    return {
      copy: "Copy",
      copied: "Copied",
      wrapOn: "Enable word wrap",
      wrapOff: "Disable word wrap",
      moreCode: "More code block actions",
      downloadCode: "Download code",
      copyTable: "Copy table",
      scrollTable: "Scrollable table",
      moreTable: "More table actions",
      download: "Download",
      failed: "Copy failed",
    };
  return {
    copy: "复制",
    copied: "已复制",
    wrapOn: "启用自动换行",
    wrapOff: "禁用自动换行",
    moreCode: "代码块更多操作",
    downloadCode: "下载代码",
    copyTable: "复制表格",
    scrollTable: "可横向滚动的表格",
    moreTable: "表格更多操作",
    download: "下载",
    failed: "复制失败",
  };
};
