import { stripFrontmatter } from "./markdown";

export interface ShareCardImageData {
  title: string;
  source: string;
  date: string;
  routingLabel: string;
  markdown: string;
  entities: string[];
  aggregateCount?: number;
}

const IMAGE_WIDTH = 1080;
const PADDING_X = 76;
const PADDING_TOP = 78;
const PADDING_BOTTOM = 72;
const GOLD = "#d7ad61";
const CREAM = "#f5ecd7";
const MUTED = "#a9a091";
const PANEL = "#242432";
const BG = "#111218";
const SLOGAN = "把每天的信息，整理成可复用的判断。";

function cleanMarkdownText(markdown: string): string {
  return stripFrontmatter(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>#-]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function summarizeCardMarkdown(markdown: string, title: string): string {
  const clean = cleanMarkdownText(markdown);
  const parts = clean
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => p !== title && !title.includes(p));
  const joined = parts.join(" ");
  if (joined.length <= 260) return joined;
  return `${joined.slice(0, 260).replace(/[，。；、\s]+$/u, "")}…`;
}

function setupCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  return { canvas, ctx };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = char;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines?: number,
): number {
  const lines = wrapText(ctx, text, maxWidth);
  const visible = typeof maxLines === "number" ? lines.slice(0, maxLines) : lines;
  visible.forEach((line, index) => {
    const value = maxLines && index === maxLines - 1 && lines.length > maxLines
      ? `${line.replace(/[，。；、\s]+$/u, "")}…`
      : line;
    ctx.fillText(value, x, y + index * lineHeight);
  });
  return y + visible.length * lineHeight;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
): number {
  ctx.font = "28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  const width = Math.ceil(ctx.measureText(label).width) + 34;
  roundedRect(ctx, x, y, width, 42, 7);
  ctx.fillStyle = "rgba(215, 173, 97, 0.13)";
  ctx.fill();
  ctx.strokeStyle = "rgba(215, 173, 97, 0.42)";
  ctx.stroke();
  ctx.fillStyle = CREAM;
  ctx.fillText(label, x + 17, y + 29);
  return width;
}

export async function renderShareCardImage(data: ShareCardImageData): Promise<Blob> {
  await document.fonts?.ready;

  const summary = summarizeCardMarkdown(data.markdown, data.title);
  const tags = [
    data.routingLabel,
    ...data.entities.slice(0, 5),
    ...(data.aggregateCount && data.aggregateCount > 1 ? [`聚合 ${data.aggregateCount} 张`] : []),
  ].filter(Boolean);

  const measure = setupCanvas(IMAGE_WIDTH, 1200).ctx;
  const contentWidth = IMAGE_WIDTH - PADDING_X * 2;
  measure.font = "700 54px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  const titleLines = wrapText(measure, data.title, contentWidth);
  measure.font = "34px Georgia, 'Times New Roman', serif";
  const summaryLines = wrapText(measure, summary, contentWidth);

  const chipRows = Math.ceil(tags.reduce((rows, tag) => {
    const width = measure.measureText(tag).width + 48;
    const last = rows[rows.length - 1] ?? 0;
    if (last + width > contentWidth) rows.push(width + 12);
    else rows[rows.length - 1] = last + width + 12;
    return rows;
  }, [0] as number[]).length);

  const height = Math.max(
    900,
    PADDING_TOP + 72 + titleLines.slice(0, 4).length * 68 + 34 +
      Math.min(5, summaryLines.length) * 50 + 54 + chipRows * 56 + 164 + PADDING_BOTTOM,
  );

  const { canvas, ctx } = setupCanvas(IMAGE_WIDTH, height);

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, IMAGE_WIDTH, height);

  const gradient = ctx.createRadialGradient(IMAGE_WIDTH * 0.8, 120, 30, IMAGE_WIDTH * 0.8, 120, 760);
  gradient.addColorStop(0, "rgba(215,173,97,0.20)");
  gradient.addColorStop(0.46, "rgba(78,83,124,0.13)");
  gradient.addColorStop(1, "rgba(17,18,24,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, IMAGE_WIDTH, height);

  roundedRect(ctx, 34, 34, IMAGE_WIDTH - 68, height - 68, 26);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.strokeStyle = "rgba(230, 217, 178, 0.75)";
  ctx.lineWidth = 2;
  ctx.stroke();

  let y = PADDING_TOP;
  ctx.fillStyle = GOLD;
  ctx.font = "700 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("CURATION", PADDING_X, y);

  ctx.fillStyle = MUTED;
  ctx.font = "26px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  ctx.fillText(data.date || "今日阅读", PADDING_X + 178, y + 1);

  y += 72;
  ctx.fillStyle = CREAM;
  ctx.font = "700 54px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  y = drawWrappedText(ctx, data.title, PADDING_X, y, contentWidth, 68, 4);

  y += 20;
  ctx.strokeStyle = "rgba(215, 173, 97, 0.62)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PADDING_X, y);
  ctx.lineTo(PADDING_X + 112, y);
  ctx.stroke();

  y += 50;
  ctx.fillStyle = "#ded6c4";
  ctx.font = "34px Georgia, 'Times New Roman', 'Songti SC', serif";
  y = drawWrappedText(ctx, summary, PADDING_X, y, contentWidth, 50, 5);

  y += 38;
  let chipX = PADDING_X;
  let chipY = y;
  for (const tag of tags) {
    const chipWidth = Math.ceil(measure.measureText(tag).width) + 46;
    if (chipX > PADDING_X && chipX + chipWidth > PADDING_X + contentWidth) {
      chipX = PADDING_X;
      chipY += 56;
    }
    const actualWidth = drawChip(ctx, tag, chipX, chipY);
    chipX += actualWidth + 12;
  }
  y = chipY + 84;

  ctx.strokeStyle = "rgba(230, 217, 178, 0.28)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_X, y);
  ctx.lineTo(IMAGE_WIDTH - PADDING_X, y);
  ctx.stroke();

  y += 48;
  ctx.fillStyle = MUTED;
  ctx.font = "28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  ctx.fillText(data.source, PADDING_X, y);

  ctx.fillStyle = GOLD;
  ctx.font = "italic 30px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "right";
  ctx.fillText(SLOGAN, IMAGE_WIDTH - PADDING_X, y);
  ctx.textAlign = "left";

  y += 66;
  ctx.fillStyle = "rgba(245, 236, 215, 0.66)";
  ctx.font = "23px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText("curationcurationcuration.cc", PADDING_X, y);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Failed to render share image"));
      else resolve(blob);
    }, "image/png", 0.96);
  });
}

export async function copyImageBlobToClipboard(blob: Blob): Promise<void> {
  const ClipboardItemCtor = window.ClipboardItem;
  if (!navigator.clipboard?.write || !ClipboardItemCtor) {
    throw new Error("当前环境不支持图片剪贴板");
  }
  await navigator.clipboard.write([
    new ClipboardItemCtor({ [blob.type]: blob }),
  ]);
}
