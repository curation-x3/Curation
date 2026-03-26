#!/usr/bin/env python3
import requests
from bs4 import BeautifulSoup
import sys
import json

def search_wechat_articles(account_name):
    print(f"[*] Searching for latest articles from: {account_name}")
    
    # Using feeddd.org as the primary mirror for verification
    # Search URL pattern
    search_url = f"https://feeddd.org/search?q={account_name}"
    header = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    try:
        response = requests.get(search_url, headers=header, timeout=10)
        if response.status_code != 200:
            print(f"[!] Error: Failed to access mirror (Status: {response.status_code})")
            return

        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Look for account links
        # feeddd search results usually point to account pages
        accounts = []
        for a in soup.find_all('a', href=True):
            if '/feeds/' in a['href']:
                accounts.append({
                    "name": a.get_text(strip=True),
                    "url": "https://feeddd.org" + a['href']
                })

        if not accounts:
            print("[!] No matching accounts found on mirror.")
            return

        # Use the first match
        target_account = accounts[0]
        print(f"[+] Found match: {target_account['name']} -> {target_account['url']}")

        # Fetch the account's feed page
        feed_resp = requests.get(target_account['url'], headers=header, timeout=10)
        feed_soup = BeautifulSoup(feed_resp.text, 'html.parser')

        # Extract article links from the feed page
        articles = []
        # Current feeddd layout has articles in a list
        for item in feed_soup.find_all('div', class_='feed-item'):
            title_node = item.find('a', class_='feed-item-title')
            if title_node:
                articles.append({
                    "title": title_node.get_text(strip=True),
                    "url": title_node['href']
                })
        
        if not articles:
            # Try a different selector if layout changed
            for a in feed_soup.find_all('a', target='_blank'):
                if 'mp.weixin.qq.com' in a.get('href', ''):
                    articles.append({
                        "title": a.get_text(strip=True),
                        "url": a['href']
                    })

        print(f"\n[ RESULTS ] Found {len(articles)} recent articles:")
        for i, art in enumerate(articles[:5]):
            print(f"{i+1}. {art['title']}")
            print(f"   URL: {art['url']}\n")

    except Exception as e:
        print(f"[!] Exception occurred: {str(e)}")

if __name__ == "__main__":
    test_account = "科技爱好者" # Hardcoded default for verification
    if len(sys.argv) > 1:
        test_account = sys.argv[1]
    
    search_wechat_articles(test_account)
