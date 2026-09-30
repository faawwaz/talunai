// Isolated child process. No shell, no URL fetching, bounded heap/input/output and parent timeout.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
  const bytes = new Uint8Array(Buffer.concat(chunks));
  const task = getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWasm: false,
    verbosity: 0,
  });
  task.onPassword = () => {
    task.destroy();
    throw new Error("PDF_ENCRYPTED");
  };
  const pdf = await task.promise;
  const maxPages = Number(process.argv[2]);
  const maxText = Number(process.argv[3]);
  if (pdf.numPages > maxPages) throw new Error("PDF_PAGE_LIMIT");
  const pages = [];
  let length = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let pageText = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      pageText += item.str + (item.hasEOL ? "\n" : " ");
      if (length + pageText.length > maxText)
        throw new Error("DOCUMENT_TEXT_LIMIT");
    }
    pages.push(pageText.trim());
    length += pageText.length;
    page.cleanup();
  }
  await task.destroy();
  process.stdout.write(
    JSON.stringify({ text: pages.join("\n\f\n"), pages: pages.length }),
  );
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const name = error instanceof Error ? error.name : "";
  const code = /password|encrypt/i.test(`${message} ${name}`)
    ? "PDF_ENCRYPTED"
    : ["PDF_PAGE_LIMIT", "DOCUMENT_TEXT_LIMIT"].includes(message)
      ? message
      : "PDF_MALFORMED";
  process.stderr.write(code);
  process.exitCode = 1;
}
