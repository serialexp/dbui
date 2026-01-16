// ABOUTME: AWS integration for importing database connections from cloud secrets.
// ABOUTME: Supports reading from SSM Parameter Store and Secrets Manager.

use aws_config::profile::ProfileFileCredentialsProvider;
use aws_config::BehaviorVersion;
use aws_sdk_secretsmanager::Client as SecretsClient;
use aws_sdk_ssm::Client as SsmClient;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsProfile {
    pub name: String,
    pub region: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsParameter {
    pub name: String,
    pub parameter_type: String,
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsSecret {
    pub name: String,
    pub arn: String,
    pub description: Option<String>,
    pub last_modified: Option<String>,
}

fn aws_credentials_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".aws")
        .join("credentials")
}

fn aws_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".aws")
        .join("config")
}

pub fn list_aws_profiles() -> Result<Vec<AwsProfile>, String> {
    let credentials_path = aws_credentials_path();
    let config_path = aws_config_path();

    if !credentials_path.exists() && !config_path.exists() {
        return Err(
            "AWS credentials not found. Ensure ~/.aws/credentials or ~/.aws/config exists."
                .to_string(),
        );
    }

    let mut profiles: HashMap<String, AwsProfile> = HashMap::new();

    if credentials_path.exists() {
        let content = std::fs::read_to_string(&credentials_path)
            .map_err(|e| format!("Failed to read credentials file: {}", e))?;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let name = trimmed[1..trimmed.len() - 1].to_string();
                profiles.entry(name.clone()).or_insert(AwsProfile {
                    name,
                    region: None,
                });
            }
        }
    }

    if config_path.exists() {
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config file: {}", e))?;

        let mut current_profile: Option<String> = None;

        for line in content.lines() {
            let trimmed = line.trim();

            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let section = &trimmed[1..trimmed.len() - 1];
                let name = if section.starts_with("profile ") {
                    section[8..].to_string()
                } else {
                    section.to_string()
                };
                current_profile = Some(name.clone());
                profiles.entry(name.clone()).or_insert(AwsProfile {
                    name,
                    region: None,
                });
            } else if let Some(ref profile_name) = current_profile {
                if trimmed.starts_with("region") {
                    if let Some((_, value)) = trimmed.split_once('=') {
                        if let Some(profile) = profiles.get_mut(profile_name) {
                            profile.region = Some(value.trim().to_string());
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<AwsProfile> = profiles.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(result)
}

async fn create_ssm_client(profile: &str, region: &str) -> Result<SsmClient, String> {
    let credentials_provider = ProfileFileCredentialsProvider::builder()
        .profile_name(profile)
        .build();

    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .credentials_provider(credentials_provider)
        .load()
        .await;

    Ok(SsmClient::new(&config))
}

async fn create_secrets_client(profile: &str, region: &str) -> Result<SecretsClient, String> {
    let credentials_provider = ProfileFileCredentialsProvider::builder()
        .profile_name(profile)
        .build();

    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(aws_config::Region::new(region.to_string()))
        .credentials_provider(credentials_provider)
        .load()
        .await;

    Ok(SecretsClient::new(&config))
}

pub async fn list_ssm_parameters(
    profile: &str,
    region: &str,
    path_prefix: Option<&str>,
) -> Result<Vec<AwsParameter>, String> {
    let client = create_ssm_client(profile, region).await?;

    let mut params = Vec::new();
    let mut next_token: Option<String> = None;

    loop {
        let mut request = client.describe_parameters();

        if let Some(prefix) = path_prefix {
            request = request.parameter_filters(
                aws_sdk_ssm::types::ParameterStringFilter::builder()
                    .key("Name")
                    .option("BeginsWith")
                    .values(prefix)
                    .build()
                    .map_err(|e| format!("Failed to build filter: {}", e))?,
            );
        }

        if let Some(token) = next_token.take() {
            request = request.next_token(token);
        }

        let response = request.send().await.map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("AccessDenied") || err_str.contains("not authorized") {
                "Access denied. Check IAM permissions for SSM Parameter Store.".to_string()
            } else {
                format!("Network error: {}", err_str)
            }
        })?;

        if let Some(parameters) = response.parameters {
            for p in parameters {
                params.push(AwsParameter {
                    name: p.name.unwrap_or_default(),
                    parameter_type: p.r#type.map(|t| t.to_string()).unwrap_or_default(),
                    last_modified: p.last_modified_date.map(|d| d.to_string()),
                });
            }
        }

        next_token = response.next_token;
        if next_token.is_none() {
            break;
        }
    }

    Ok(params)
}

pub async fn get_ssm_parameter_value(
    profile: &str,
    region: &str,
    name: &str,
) -> Result<String, String> {
    let client = create_ssm_client(profile, region).await?;

    let response = client
        .get_parameter()
        .name(name)
        .with_decryption(true)
        .send()
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("AccessDenied") || err_str.contains("not authorized") {
                "Access denied. Check IAM permissions for SSM Parameter Store.".to_string()
            } else {
                format!("Network error: {}", err_str)
            }
        })?;

    response
        .parameter
        .and_then(|p| p.value)
        .ok_or_else(|| "Parameter value not found".to_string())
}

pub async fn list_aws_secrets(profile: &str, region: &str) -> Result<Vec<AwsSecret>, String> {
    let client = create_secrets_client(profile, region).await?;

    let mut secrets = Vec::new();
    let mut next_token: Option<String> = None;

    loop {
        let mut request = client.list_secrets();

        if let Some(token) = next_token.take() {
            request = request.next_token(token);
        }

        let response = request.send().await.map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("AccessDenied") || err_str.contains("not authorized") {
                "Access denied. Check IAM permissions for Secrets Manager.".to_string()
            } else {
                format!("Network error: {}", err_str)
            }
        })?;

        if let Some(secret_list) = response.secret_list {
            for s in secret_list {
                secrets.push(AwsSecret {
                    name: s.name.unwrap_or_default(),
                    arn: s.arn.unwrap_or_default(),
                    description: s.description,
                    last_modified: s.last_changed_date.map(|d| d.to_string()),
                });
            }
        }

        next_token = response.next_token;
        if next_token.is_none() {
            break;
        }
    }

    Ok(secrets)
}

pub async fn get_aws_secret_value(
    profile: &str,
    region: &str,
    secret_id: &str,
) -> Result<String, String> {
    let client = create_secrets_client(profile, region).await?;

    let response = client
        .get_secret_value()
        .secret_id(secret_id)
        .send()
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("AccessDenied") || err_str.contains("not authorized") {
                "Access denied. Check IAM permissions for Secrets Manager.".to_string()
            } else {
                format!("Network error: {}", err_str)
            }
        })?;

    response
        .secret_string
        .ok_or_else(|| "Secret is binary, not a string".to_string())
}
