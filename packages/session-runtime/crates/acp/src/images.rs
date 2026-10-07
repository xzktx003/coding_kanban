use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AcpImage {
    pub mime_type: String,
    pub data: String,
}

pub(crate) fn prompt_blocks(
    text: &str,
    images: &[AcpImage],
    supported: bool,
) -> Result<Vec<Value>, String> {
    if !images.is_empty() && !supported {
        return Err("当前 Agent 不支持图片输入".into());
    }
    let mut blocks = Vec::new();
    if !text.is_empty() {
        blocks.push(json!({ "type": "text", "text": text }));
    }
    for image in images {
        blocks.push(json!({ "type": "image", "mimeType": image.mime_type, "data": image.data }));
    }
    if blocks.is_empty() {
        blocks.push(json!({ "type": "text", "text": "" }));
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_prompt_preserves_text_and_mime_and_supports_image_only() {
        let images = [AcpImage {
            mime_type: "image/png".into(),
            data: "aGVsbG8=".into(),
        }];
        let blocks = prompt_blocks("explain", &images, true).unwrap();
        assert_eq!(blocks[0]["text"], "explain");
        assert_eq!(
            blocks[1],
            json!({"type":"image","mimeType":"image/png","data":"aGVsbG8="})
        );
        assert_eq!(prompt_blocks("", &images, true).unwrap().len(), 1);
        assert!(prompt_blocks("explain", &images, false).is_err());
        assert_eq!(
            prompt_blocks("plain", &[], false).unwrap(),
            vec![json!({"type":"text","text":"plain"})]
        );
    }
}
