use base64::Engine;
use codexia_acp::images::AcpImage;
use std::path::{Path, PathBuf};

pub(super) async fn read_images(paths: &[String], root: &Path) -> Result<Vec<AcpImage>, String> {
    if paths.is_empty() {
        return Ok(vec![]);
    }
    if paths.len() > 8 {
        return Err("最多发送 8 张图片".into());
    }
    let root = tokio::fs::canonicalize(root)
        .await
        .map_err(|_| "图片附件目录不可用")?;
    let mut images = Vec::new();
    let mut total = 0;
    for path in paths {
        let canonical = tokio::fs::canonicalize(PathBuf::from(path))
            .await
            .map_err(|_| "图片附件不存在")?;
        if !canonical.starts_with(&root) {
            return Err("图片必须来自当前应用的附件目录".into());
        }
        let metadata = tokio::fs::metadata(&canonical)
            .await
            .map_err(|_| "无法读取图片信息")?;
        if !metadata.is_file() || metadata.len() > 10 * 1024 * 1024 {
            return Err("图片不能超过 10 MB".into());
        }
        total += metadata.len();
        if total > 32 * 1024 * 1024 {
            return Err("图片总大小不能超过 32 MB".into());
        }
        let bytes = tokio::fs::read(&canonical)
            .await
            .map_err(|_| "无法读取图片")?;
        let mime = image_mime(&bytes).ok_or("仅支持 PNG、JPEG、GIF、WebP 图片")?;
        images.push(AcpImage {
            mime_type: mime.into(),
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        });
    }
    Ok(images)
}
fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn rejects_outside_and_disguised_files_and_encodes_valid_uploads() {
        let dir = tempfile::tempdir().unwrap();
        let uploads = dir.path().join("uploads");
        tokio::fs::create_dir(&uploads).await.unwrap();
        let good = uploads.join("good.png");
        tokio::fs::write(&good, b"\x89PNG\r\n\x1a\nfixture")
            .await
            .unwrap();
        let result = read_images(&[good.to_string_lossy().into()], &uploads)
            .await
            .unwrap();
        assert_eq!(result[0].mime_type, "image/png");
        let outside = dir.path().join("private.png");
        tokio::fs::write(&outside, b"secret").await.unwrap();
        assert!(
            read_images(&[outside.to_string_lossy().into()], &uploads)
                .await
                .is_err()
        );
        let fake = uploads.join("fake.png");
        tokio::fs::write(&fake, b"plain text").await.unwrap();
        assert!(
            read_images(&[fake.to_string_lossy().into()], &uploads)
                .await
                .is_err()
        );
        #[cfg(unix)]
        {
            let link = uploads.join("link.png");
            std::os::unix::fs::symlink(&outside, &link).unwrap();
            assert!(
                read_images(&[link.to_string_lossy().into()], &uploads)
                    .await
                    .is_err()
            );
        }
    }
}
