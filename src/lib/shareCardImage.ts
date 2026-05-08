import { stripFrontmatter } from "./markdown";

export interface ShareCardImageData {
  title: string;
  source: string;
  date: string;
  routingLabel: string;
  markdown: string;
  entities: string[];
  contextEntities?: string[];
  aggregateCount?: number;
}

const IMAGE_WIDTH = 1080;
const PADDING_X = 76;
const PADDING_TOP = 78;
const PADDING_BOTTOM = 72;
const PANEL_INSET = 34;
const GOLD = "#d7ad61";
const CREAM = "#f5ecd7";
const MUTED = "#a9a091";
const PANEL = "#242432";
const BG = "#111218";
const SLOGAN = "把每天的信息，整理成可复用的判断。";

type TextBlock = {
  kind: "heading" | "paragraph" | "bullet";
  text: string;
};

type ChipVariant = "routing" | "core" | "context" | "aggregate";

type Chip = {
  label: string;
  variant: ChipVariant;
};

type TextLayout = TextBlock & {
  font: string;
  color: string;
  lineHeight: number;
  topGap: number;
  lines: string[];
};

function cleanInlineMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`>]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function parseShareCardBlocks(markdown: string, title: string): TextBlock[] {
  const blocks: TextBlock[] = [];
  const paragraph: string[] = [];
  let inFence = false;
  let skippingLinks = false;

  function flushParagraph() {
    const text = cleanInlineMarkdown(paragraph.join(" "));
    paragraph.length = 0;
    if (text && text !== title && !title.includes(text)) {
      blocks.push({ kind: "paragraph", text });
    }
  }

  for (const rawLine of stripFrontmatter(markdown).replace(/\r\n/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const headingText = cleanInlineMarkdown(heading[2]);
      if (/^链接$|^References?$|^Sources?$/i.test(headingText)) {
        skippingLinks = true;
        continue;
      }
      skippingLinks = false;
      if (heading[1].length > 1 && headingText && headingText !== title) {
        blocks.push({ kind: "heading", text: headingText });
      }
      continue;
    }

    if (skippingLinks) continue;
    if (!line) {
      flushParagraph();
      continue;
    }

    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      const text = cleanInlineMarkdown(bullet[1]);
      if (text) blocks.push({ kind: "bullet", text });
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return blocks;
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
  let pendingSpace = "";
  const tokens = text.match(/[A-Za-z0-9]+(?:[._:/+-][A-Za-z0-9]+)*|\s+|./gu) ?? [];

  function pushLongToken(token: string) {
    for (const char of token) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
  }

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      if (line) pendingSpace = " ";
      continue;
    }
    const next = line + pendingSpace + token;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = "";
      pendingSpace = "";
      if (ctx.measureText(token).width > maxWidth) {
        pushLongToken(token);
      } else {
        line = token;
      }
    } else {
      line = next;
      pendingSpace = "";
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
): number {
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function chipWidth(ctx: CanvasRenderingContext2D, label: string): number {
  ctx.font = "28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  return Math.ceil(ctx.measureText(label).width) + 34;
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  chip: Chip,
  x: number,
  y: number,
): number {
  ctx.font = "28px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  const width = chipWidth(ctx, chip.label);
  roundedRect(ctx, x, y, width, 42, 7);
  ctx.fillStyle = chip.variant === "context" ? "rgba(245, 236, 215, 0.03)" : "rgba(215, 173, 97, 0.13)";
  ctx.fill();
  ctx.strokeStyle = chip.variant === "context" ? "rgba(245, 236, 215, 0.24)" : "rgba(215, 173, 97, 0.42)";
  ctx.stroke();
  ctx.fillStyle = chip.variant === "context" ? MUTED : CREAM;
  ctx.fillText(chip.label, x + 17, y + 29);
  return width;
}

function makeTextLayout(
  ctx: CanvasRenderingContext2D,
  block: TextBlock,
  contentWidth: number,
): TextLayout {
  const style = block.kind === "heading"
    ? {
        font: "700 32px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
        color: GOLD,
        lineHeight: 44,
        topGap: 42,
      }
    : block.kind === "bullet"
      ? {
          font: "27px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
          color: "#ddd4c2",
          lineHeight: 40,
          topGap: 16,
        }
      : {
          font: "31px Georgia, 'Times New Roman', 'Songti SC', serif",
          color: "#ded6c4",
          lineHeight: 47,
          topGap: 26,
        };
  ctx.font = style.font;
  const textWidth = block.kind === "bullet" ? contentWidth - 30 : contentWidth;
  return {
    ...block,
    ...style,
    lines: wrapText(ctx, block.text, textWidth),
  };
}

function measureChipRows(ctx: CanvasRenderingContext2D, chips: Chip[], contentWidth: number): number {
  if (chips.length === 0) return 0;
  let rows = 1;
  let rowWidth = 0;
  for (const chip of chips) {
    const width = chipWidth(ctx, chip.label) + 12;
    if (rowWidth > 0 && rowWidth + width > contentWidth) {
      rows += 1;
      rowWidth = width;
    } else {
      rowWidth += width;
    }
  }
  return rows;
}

function drawBodyBlock(
  ctx: CanvasRenderingContext2D,
  block: TextLayout,
  x: number,
  y: number,
  contentWidth: number,
): number {
  y += block.topGap;
  ctx.fillStyle = block.color;
  ctx.font = block.font;

  if (block.kind === "bullet") {
    ctx.fillStyle = "rgba(215, 173, 97, 0.78)";
    ctx.beginPath();
    ctx.arc(x + 7, y - 10, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = block.color;
    block.lines.forEach((line, index) => {
      ctx.fillText(line, x + 30, y + index * block.lineHeight);
    });
    return y + block.lines.length * block.lineHeight;
  }

  return drawWrappedText(ctx, block.text, x, y, contentWidth, block.lineHeight);
}

export async function renderShareCardImage(data: ShareCardImageData): Promise<Blob> {
  await document.fonts?.ready;

  const chips: Chip[] = [
    { label: data.routingLabel, variant: "routing" as const },
    ...data.entities.slice(0, 6).map((label) => ({ label, variant: "core" as const })),
    ...(data.contextEntities ?? []).slice(0, 4).map((label) => ({ label, variant: "context" as const })),
    ...(data.aggregateCount && data.aggregateCount > 1
      ? [{ label: `聚合 ${data.aggregateCount} 张`, variant: "aggregate" as const }]
      : []),
  ].filter((chip) => chip.label);

  const measure = setupCanvas(IMAGE_WIDTH, 1200).ctx;
  const contentWidth = IMAGE_WIDTH - PADDING_X * 2;
  measure.font = "700 54px -apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif";
  const titleLines = wrapText(measure, data.title, contentWidth);
  const bodyLayouts = parseShareCardBlocks(data.markdown, data.title)
    .map((block) => makeTextLayout(measure, block, contentWidth));
  const chipRows = measureChipRows(measure, chips, contentWidth);
  const bodyHeight = bodyLayouts.reduce(
    (total, block) => total + block.topGap + Math.max(1, block.lines.length) * block.lineHeight,
    0,
  );
  const footerHeight = 48 + 1 + 48 + 66;
  const height = Math.max(
    1180,
    PADDING_TOP + 72 + titleLines.length * 68 + 20 + 3 +
      bodyHeight + 48 + chipRows * 56 + footerHeight + PADDING_BOTTOM,
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

  roundedRect(ctx, PANEL_INSET, PANEL_INSET, IMAGE_WIDTH - PANEL_INSET * 2, height - PANEL_INSET * 2, 26);
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
  y = drawWrappedText(ctx, data.title, PADDING_X, y, contentWidth, 68);

  y += 20;
  ctx.strokeStyle = "rgba(215, 173, 97, 0.62)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(PADDING_X, y);
  ctx.lineTo(PADDING_X + 112, y);
  ctx.stroke();

  for (const block of bodyLayouts) {
    y = drawBodyBlock(ctx, block, PADDING_X, y, contentWidth);
  }

  y += 48;
  let chipX = PADDING_X;
  let chipY = y;
  for (const chip of chips) {
    const measuredChipWidth = chipWidth(ctx, chip.label);
    if (chipX > PADDING_X && chipX + measuredChipWidth > PADDING_X + contentWidth) {
      chipX = PADDING_X;
      chipY += 56;
    }
    const actualWidth = drawChip(ctx, chip, chipX, chipY);
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
