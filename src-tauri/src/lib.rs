use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Article {
    pub title: String,
    pub url: String,
    pub summary: String,
    pub score: f32,
    pub reason: String,
    pub source: String,
    pub published: String,
}

// ─── Simple RSS/XML parser ────────────────────────────────────────────────────

fn extract_tag_content(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    let raw = xml[start..end].trim().to_string();
    // strip CDATA
    let cleaned = if raw.starts_with("<![CDATA[") && raw.ends_with("]]>") {
        raw[9..raw.len() - 3].to_string()
    } else {
        raw
    };
    Some(html_entities_decode(&cleaned))
}

fn html_entities_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

/// Strip HTML tags from a string.
fn strip_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    // collapse whitespace
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_rss_items(xml: &str) -> Vec<RawItem> {
    let mut items = Vec::new();
    let mut remaining = xml;

    while let Some(start) = remaining.find("<item>").or_else(|| remaining.find("<item ")) {
        let after_open = &remaining[start..];
        let content_start = after_open.find('>').map(|i| i + 1).unwrap_or(6);
        let content = &after_open[content_start..];

        let end = match content.find("</item>") {
            Some(e) => e,
            None => break,
        };
        let item_xml = &content[..end];

        let title = extract_tag_content(item_xml, "title")
            .unwrap_or_default();
        let link = extract_tag_content(item_xml, "link")
            .unwrap_or_default();
        let description = extract_tag_content(item_xml, "description")
            .or_else(|| extract_tag_content(item_xml, "content:encoded"))
            .unwrap_or_default();
        let pub_date = extract_tag_content(item_xml, "pubDate")
            .or_else(|| extract_tag_content(item_xml, "published"))
            .or_else(|| extract_tag_content(item_xml, "dc:date"))
            .unwrap_or_default();

        if !title.is_empty() || !link.is_empty() {
            items.push(RawItem {
                title: strip_html(&title),
                url: link.trim().to_string(),
                description: strip_html(&description),
                published: pub_date,
            });
        }

        let consumed = start + content_start + end + 7; // 7 = "</item>".len()
        if consumed >= remaining.len() {
            break;
        }
        remaining = &remaining[consumed..];
    }
    items
}

struct RawItem {
    title: String,
    url: String,
    description: String,
    published: String,
}

// ─── LLM scoring ─────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
struct LlmMessage {
    role: String,
    content: String,
}

#[derive(Serialize, Deserialize, Debug)]
struct LlmRequest {
    model: String,
    messages: Vec<LlmMessage>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Serialize, Deserialize, Debug)]
struct LlmChoice {
    message: LlmMessage,
}

#[derive(Serialize, Deserialize, Debug)]
struct LlmResponse {
    choices: Vec<LlmChoice>,
}

/// Score a batch of articles with one LLM call. Returns a map: index -> (score, reason).
async fn score_articles_batch(
    items: &[RawItem],
    api_key: &str,
    api_endpoint: &str,
    model: &str,
    user_interests: &str,
    source: &str,
) -> Result<Vec<(f32, String)>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    // Build article list for the prompt
    let mut article_list = String::new();
    for (i, item) in items.iter().enumerate() {
        let snippet = if item.description.len() > 300 {
            format!("{}…", &item.description[..300])
        } else {
            item.description.clone()
        };
        article_list.push_str(&format!(
            "{}. Title: {}\n   URL: {}\n   Snippet: {}\n\n",
            i + 1,
            item.title,
            item.url,
            snippet
        ));
    }

    let prompt = format!(
        "You are a personal content curator. The user's interests are: {}\n\n\
        Rate each of the following {} articles on a scale from 0.0 to 10.0 based on how relevant and interesting they are to the user.\n\n\
        Articles:\n{}\n\
        Respond ONLY with a JSON array of objects, one per article, in order. Each object must have:\n\
        - \"score\": number 0.0-10.0\n\
        - \"reason\": string, one sentence explaining the score\n\
        Example: [{{\"score\": 8.5, \"reason\": \"Directly relevant to Rust programming.\"}}, ...]\n\
        Do not include any text outside the JSON array.",
        user_interests,
        items.len(),
        article_list
    );

    let request_body = LlmRequest {
        model: model.to_string(),
        messages: vec![LlmMessage {
            role: "user".to_string(),
            content: prompt,
        }],
        temperature: 0.2,
        max_tokens: 2048,
    };

    let endpoint = format!(
        "{}/chat/completions",
        api_endpoint.trim_end_matches('/')
    );

    let response = client
        .post(&endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, body));
    }

    let llm_resp: LlmResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse LLM response: {}", e))?;

    let content = llm_resp
        .choices
        .first()
        .map(|c| c.message.content.as_str())
        .unwrap_or("[]");

    // Extract JSON array from content (may be wrapped in markdown code block)
    let json_str = extract_json_array(content);

    let parsed: Vec<HashMap<String, serde_json::Value>> =
        serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse scores JSON ({}): {}", e, json_str))?;

    let mut results = Vec::new();
    for entry in parsed {
        let score = entry
            .get("score")
            .and_then(|v| v.as_f64())
            .unwrap_or(5.0) as f32;
        let reason = entry
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let score = score.clamp(0.0, 10.0);
        results.push((score, reason));
    }

    // Pad if LLM returned fewer items
    while results.len() < items.len() {
        results.push((5.0, format!("Content from {}", source)));
    }

    Ok(results)
}

fn extract_json_array(s: &str) -> String {
    // Strip markdown code blocks if present
    let s = s.trim();
    let s = if s.starts_with("```") {
        s.lines()
            .skip(1)
            .take_while(|l| !l.starts_with("```"))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        s.to_string()
    };
    // Find the array
    if let Some(start) = s.find('[') {
        if let Some(end) = s.rfind(']') {
            return s[start..=end].to_string();
        }
    }
    s
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

mod commands {
    use super::*;

#[tauri::command]
pub async fn fetch_url_content(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; CurationBot/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {}: {}", url, e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    Ok(text)
}

#[tauri::command]
pub async fn fetch_and_curate(
    sources: Vec<String>,
    api_key: String,
    api_endpoint: String,
    model: String,
    user_interests: String,
) -> Result<Vec<Article>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; CurationBot/1.0)")
        .build()
        .map_err(|e| e.to_string())?;

    let mut all_raw: Vec<(RawItem, String)> = Vec::new(); // (item, source_url)

    for source_url in &sources {
        let resp = match client.get(source_url).send().await {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Failed to fetch {}: {}", source_url, e);
                continue;
            }
        };
        let body = match resp.text().await {
            Ok(t) => t,
            Err(e) => {
                eprintln!("Failed to read body for {}: {}", source_url, e);
                continue;
            }
        };

        let is_rss = body.contains("<rss") || body.contains("<feed") || body.contains("<channel");
        if is_rss {
            let items = parse_rss_items(&body);
            for item in items.into_iter().take(20) {
                all_raw.push((item, source_url.clone()));
            }
        } else {
            // Treat as a webpage: extract title + first text snippet
            let title = extract_tag_content(&body, "title").unwrap_or_else(|| source_url.clone());
            let snippet = strip_html(&body);
            let snippet = snippet
                .split_whitespace()
                .take(150)
                .collect::<Vec<_>>()
                .join(" ");
            all_raw.push((
                RawItem {
                    title,
                    url: source_url.clone(),
                    description: snippet,
                    published: String::new(),
                },
                source_url.clone(),
            ));
        }
    }

    if all_raw.is_empty() {
        return Ok(vec![]);
    }

    // Score in batches of up to 15
    const BATCH_SIZE: usize = 15;
    let mut articles: Vec<Article> = Vec::new();

    for chunk in all_raw.chunks(BATCH_SIZE) {
        let _items: Vec<&RawItem> = chunk.iter().map(|(item, _)| item).collect();
        let source = chunk.first().map(|(_, s)| s.as_str()).unwrap_or("");

        // Build owned slice for the batch call
        let owned: Vec<RawItem> = chunk
            .iter()
            .map(|(item, _)| RawItem {
                title: item.title.clone(),
                url: item.url.clone(),
                description: item.description.clone(),
                published: item.published.clone(),
            })
            .collect();

        match score_articles_batch(
            &owned,
            &api_key,
            &api_endpoint,
            &model,
            &user_interests,
            source,
        )
        .await
        {
            Ok(scores) => {
                for (i, (item, src)) in chunk.iter().enumerate() {
                    let (score, reason) = scores
                        .get(i)
                        .cloned()
                        .unwrap_or((5.0, String::new()));
                    articles.push(Article {
                        title: item.title.clone(),
                        url: item.url.clone(),
                        summary: if item.description.len() > 200 {
                            format!("{}…", &item.description[..200])
                        } else {
                            item.description.clone()
                        },
                        score,
                        reason,
                        source: src.clone(),
                        published: item.published.clone(),
                    });
                }
            }
            Err(e) => {
                // On batch failure, include items without scoring
                eprintln!("Scoring error: {}", e);
                for (item, src) in chunk.iter() {
                    articles.push(Article {
                        title: item.title.clone(),
                        url: item.url.clone(),
                        summary: if item.description.len() > 200 {
                            format!("{}…", &item.description[..200])
                        } else {
                            item.description.clone()
                        },
                        score: 5.0,
                        reason: format!("Scoring failed: {}", e),
                        source: src.clone(),
                        published: item.published.clone(),
                    });
                }
            }
        }
    }

    articles.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(articles)
}

} // end mod commands

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::fetch_and_curate,
            commands::fetch_url_content
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
