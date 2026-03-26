from cleaner import cleaner
from pathlib import Path

def test_on_real_article():
    # Use one of the recently captured articles
    save_dir = Path(__file__).parent / "received_articles"
    html_files = list(save_dir.glob("*.html"))
    
    if not html_files:
        print("No HTML files found in received_articles/ to test with.")
        return

    # Pick the largest one (likely the real article, not 'Test')
    latest_file = max(html_files, key=lambda p: p.stat().st_size)
    print(f"Testing cleaner on: {latest_file.name}")
    
    with open(latest_file, "r", encoding="utf-8") as f:
        html = f.read()
    
    markdown = cleaner.clean(html)
    
    # Save test output
    test_out = save_dir / "test_output.md"
    with open(test_out, "w", encoding="utf-8") as f:
        f.write(markdown)
    
    print(f"✅ Cleaned output saved to {test_out}")
    print("\n--- Preview (first 500 chars) ---")
    print(markdown[:500])
    print("\n--- End Preview ---")

if __name__ == "__main__":
    test_on_real_article()
