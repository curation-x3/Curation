from bs4 import BeautifulSoup, NavigableString
import re

class WeChatCleaner:
    def __init__(self):
        pass

    def clean(self, html_content: str) -> str:
        """
        Converts WeChat article HTML (typically #js_content) to clean Markdown.
        """
        soup = BeautifulSoup(html_content, "lxml")
        
        # 1. Target the main content if not already provided
        content = soup.find(id="js_content") or soup
        
        # 2. Pre-process: Remove noisy elements
        for tag in content.find_all(["script", "style", "iframe", "noscript"]):
            tag.decompose()
        
        # Remove empty sections/divs that only contain whitespace
        for tag in content.find_all(["section", "div"]):
            if not tag.get_text(strip=True) and not tag.find("img"):
                tag.decompose()

        return self._parse_node(content).strip()

    def _parse_node(self, node) -> str:
        md = ""
        for child in node.children:
            if isinstance(child, NavigableString):
                text = str(child).strip()
                if text:
                    md += text
            else:
                tag = child.name
                
                # Headers
                if tag in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                    level = int(tag[1])
                    md += f"\n\n{'#' * level} {self._parse_node(child).strip()}\n\n"
                
                # WeChat specific headers (often use <section> with styles)
                elif tag == "section" and self._is_likely_header(child):
                    md += f"\n\n### {self._parse_node(child).strip()}\n\n"
                
                # Paragraphs and Blocks
                elif tag in ["p", "section", "div"]:
                    inner = self._parse_node(child).strip()
                    if inner:
                        md += f"\n\n{inner}\n\n"
                
                # Line breaks
                elif tag == "br":
                    md += "\n"
                
                # Images
                elif tag == "img":
                    # WeChat uses data-src for lazy loading
                    src = child.get("data-src") or child.get("src")
                    if src:
                        md += f"\n\n![image]({src})\n\n"
                
                # Links
                elif tag == "a":
                    href = child.get("href", "#")
                    text = self._parse_node(child).strip()
                    if text:
                        md += f" [{text}]({href}) "
                
                # Formatting
                elif tag in ["strong", "b"]:
                    md += f" **{self._parse_node(child).strip()}** "
                elif tag in ["em", "i"]:
                    md += f" *{self._parse_node(child).strip()}* "
                
                # Code cases
                elif tag == "code":
                    md += f" `{child.get_text()}` "
                elif tag == "pre":
                    md += f"\n\n```\n{child.get_text()}\n```\n\n"
                
                # Lists
                elif tag == "ul":
                    md += f"\n{self._parse_node(child)}\n"
                elif tag == "ol":
                    md += f"\n{self._parse_node(child)}\n"
                elif tag == "li":
                    md += f"- {self._parse_node(child).strip()}\n"
                
                # Blockquotes
                elif tag == "blockquote":
                    md += f"\n> {self._parse_node(child).strip()}\n"
                
                else:
                    # Fallback: just append children
                    md += self._parse_node(child)
        
        # Final cleanup for the node's result
        md = re.sub(r'\n{3,}', '\n\n', md)
        return md

    def _is_likely_header(self, tag) -> bool:
        """
        Heuristic to detect if a <section> is being used as a header.
        WeChat styles often set specific colors or bold for headers.
        """
        style = tag.get("style", "").lower()
        if "font-weight: bold" in style or "font-weight:bold" in style:
            # If it's short, it's likely a header
            if len(tag.get_text(strip=True)) < 50:
                return True
        return False

cleaner = WeChatCleaner()

if __name__ == "__main__":
    # Quick test if run directly
    test_html = "<h1>Title</h1><p>Para 1</p><section style='font-weight:bold'>Section Header</section><img data-src='http://img.png'>"
    print(cleaner.clean(test_html))
