// ABOUTME: Kubernetes integration for importing database connections from secrets.
// ABOUTME: Parses kubeconfig and fetches secret values via the Kubernetes API.

use k8s_openapi::api::core::v1::{Namespace, Secret};
use kube::api::{Api, ListParams};
use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::Client;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeContext {
    pub name: String,
    pub cluster: String,
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeNamespace {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeSecret {
    pub name: String,
    pub namespace: String,
    pub secret_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KubeSecretKey {
    pub key: String,
}

fn kubeconfig_path() -> PathBuf {
    if let Ok(path) = std::env::var("KUBECONFIG") {
        PathBuf::from(path)
    } else {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".kube")
            .join("config")
    }
}

pub fn list_kube_contexts() -> Result<Vec<KubeContext>, String> {
    let path = kubeconfig_path();

    if !path.exists() {
        return Err(format!(
            "Kubeconfig not found at {}",
            path.display()
        ));
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read kubeconfig: {}", e))?;

    let config: Kubeconfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse kubeconfig: {}", e))?;

    let contexts = config
        .contexts
        .into_iter()
        .filter_map(|named_ctx| {
            let ctx = named_ctx.context?;
            Some(KubeContext {
                name: named_ctx.name,
                cluster: ctx.cluster,
                user: ctx.user.unwrap_or_default(),
            })
        })
        .collect();

    Ok(contexts)
}

async fn create_kube_client(context: &str) -> Result<Client, String> {
    let path = kubeconfig_path();

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read kubeconfig: {}", e))?;

    let kubeconfig: Kubeconfig = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse kubeconfig: {}", e))?;

    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        ..Default::default()
    };

    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|e| format!("Failed to create kube config: {}", e))?;

    Client::try_from(config).map_err(|e| format!("Failed to create kube client: {}", e))
}

pub async fn list_kube_namespaces(context: &str) -> Result<Vec<KubeNamespace>, String> {
    let client = create_kube_client(context).await?;
    let namespaces: Api<Namespace> = Api::all(client);

    let list = namespaces
        .list(&ListParams::default())
        .await
        .map_err(|e| {
            let err_str = e.to_string();
            if err_str.contains("Forbidden") || err_str.contains("Unauthorized") {
                "Access denied. Check RBAC permissions for listing namespaces.".to_string()
            } else {
                format!("Network error: {}", err_str)
            }
        })?;

    let result = list
        .items
        .into_iter()
        .filter_map(|ns| ns.metadata.name.map(|name| KubeNamespace { name }))
        .collect();

    Ok(result)
}

pub async fn list_kube_secrets(
    context: &str,
    namespace: &str,
) -> Result<Vec<KubeSecret>, String> {
    let client = create_kube_client(context).await?;
    let secrets: Api<Secret> = Api::namespaced(client, namespace);

    let list = secrets.list(&ListParams::default()).await.map_err(|e| {
        let err_str = e.to_string();
        if err_str.contains("Forbidden") || err_str.contains("Unauthorized") {
            "Access denied. Check RBAC permissions for listing secrets.".to_string()
        } else {
            format!("Network error: {}", err_str)
        }
    })?;

    let result = list
        .items
        .into_iter()
        .filter_map(|secret| {
            let name = secret.metadata.name?;
            let secret_type = secret.type_.unwrap_or_else(|| "Opaque".to_string());
            Some(KubeSecret {
                name,
                namespace: namespace.to_string(),
                secret_type,
            })
        })
        .collect();

    Ok(result)
}

pub async fn list_kube_secret_keys(
    context: &str,
    namespace: &str,
    secret_name: &str,
) -> Result<Vec<KubeSecretKey>, String> {
    let client = create_kube_client(context).await?;
    let secrets: Api<Secret> = Api::namespaced(client, namespace);

    let secret = secrets.get(secret_name).await.map_err(|e| {
        let err_str = e.to_string();
        if err_str.contains("Forbidden") || err_str.contains("Unauthorized") {
            "Access denied. Check RBAC permissions for reading secrets.".to_string()
        } else if err_str.contains("NotFound") {
            format!("Secret '{}' not found in namespace '{}'", secret_name, namespace)
        } else {
            format!("Network error: {}", err_str)
        }
    })?;

    let keys = secret
        .data
        .unwrap_or_else(BTreeMap::new)
        .keys()
        .map(|k| KubeSecretKey { key: k.clone() })
        .collect();

    Ok(keys)
}

pub async fn get_kube_secret_value(
    context: &str,
    namespace: &str,
    secret_name: &str,
    key: &str,
) -> Result<String, String> {
    let client = create_kube_client(context).await?;
    let secrets: Api<Secret> = Api::namespaced(client, namespace);

    let secret = secrets.get(secret_name).await.map_err(|e| {
        let err_str = e.to_string();
        if err_str.contains("Forbidden") || err_str.contains("Unauthorized") {
            "Access denied. Check RBAC permissions for reading secrets.".to_string()
        } else if err_str.contains("NotFound") {
            format!("Secret '{}' not found in namespace '{}'", secret_name, namespace)
        } else {
            format!("Network error: {}", err_str)
        }
    })?;

    let data = secret.data.ok_or_else(|| "Secret has no data".to_string())?;

    let value = data
        .get(key)
        .ok_or_else(|| format!("Key '{}' not found in secret", key))?;

    String::from_utf8(value.0.clone())
        .map_err(|_| "Secret value is not valid UTF-8".to_string())
}
