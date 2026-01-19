// ABOUTME: Parses database connection URLs into structured connection fields.
// ABOUTME: Supports postgres://, mysql://, sqlite://, and redis:// URL schemes.

use crate::storage::DatabaseType;
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParsedConnection {
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Unsupported database scheme: {0}. Expected postgres, postgresql, mysql, mariadb, sqlite, or redis")]
    UnsupportedScheme(String),
    #[error("Missing host in connection URL")]
    MissingHost,
    #[error("Missing username in connection URL")]
    MissingUsername,
}

pub fn parse_connection_url(url_str: &str) -> Result<ParsedConnection, ParseError> {
    let url = Url::parse(url_str).map_err(|e| ParseError::InvalidUrl(e.to_string()))?;

    let scheme = url.scheme().to_lowercase();
    let db_type = match scheme.as_str() {
        "postgres" | "postgresql" => DatabaseType::Postgres,
        "mysql" | "mariadb" => DatabaseType::Mysql,
        "sqlite" => DatabaseType::Sqlite,
        "redis" => DatabaseType::Redis,
        other => return Err(ParseError::UnsupportedScheme(other.to_string())),
    };

    if db_type == DatabaseType::Sqlite {
        let path = url.path().to_string();
        return Ok(ParsedConnection {
            db_type,
            host: String::new(),
            port: 0,
            username: String::new(),
            password: String::new(),
            database: Some(path),
        });
    }

    let host = url
        .host_str()
        .ok_or(ParseError::MissingHost)?
        .to_string();

    let username = url.username();
    // Redis doesn't require username
    if username.is_empty() && db_type != DatabaseType::Redis {
        return Err(ParseError::MissingUsername);
    }

    let password = url.password().unwrap_or("").to_string();
    let password = percent_decode(&password);

    let default_port = match db_type {
        DatabaseType::Postgres => 5432,
        DatabaseType::Mysql => 3306,
        DatabaseType::Sqlite => 0,
        DatabaseType::Redis => 6379,
    };

    let port = url.port().unwrap_or(default_port);

    let database = {
        let path = url.path();
        if path.len() > 1 {
            Some(path[1..].to_string())
        } else {
            None
        }
    };

    Ok(ParsedConnection {
        db_type,
        host,
        port,
        username: percent_decode(username),
        password,
        database,
    })
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .to_string()
}

impl PartialEq for DatabaseType {
    fn eq(&self, other: &Self) -> bool {
        matches!(
            (self, other),
            (DatabaseType::Postgres, DatabaseType::Postgres)
                | (DatabaseType::Mysql, DatabaseType::Mysql)
                | (DatabaseType::Sqlite, DatabaseType::Sqlite)
                | (DatabaseType::Redis, DatabaseType::Redis)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_postgres_full_url() {
        let url = "postgres://user:pass@localhost:5432/mydb";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.db_type, DatabaseType::Postgres);
        assert_eq!(result.host, "localhost");
        assert_eq!(result.port, 5432);
        assert_eq!(result.username, "user");
        assert_eq!(result.password, "pass");
        assert_eq!(result.database, Some("mydb".to_string()));
    }

    #[test]
    fn parse_postgres_with_default_port() {
        let url = "postgres://user:pass@db.example.com/production";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.port, 5432);
        assert_eq!(result.host, "db.example.com");
        assert_eq!(result.database, Some("production".to_string()));
    }

    #[test]
    fn parse_postgresql_scheme() {
        let url = "postgresql://user:pass@localhost/testdb";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.db_type, DatabaseType::Postgres);
    }

    #[test]
    fn parse_mysql_full_url() {
        let url = "mysql://root:secret@mysql.local:3307/app_db";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.db_type, DatabaseType::Mysql);
        assert_eq!(result.host, "mysql.local");
        assert_eq!(result.port, 3307);
        assert_eq!(result.username, "root");
        assert_eq!(result.password, "secret");
        assert_eq!(result.database, Some("app_db".to_string()));
    }

    #[test]
    fn parse_mysql_with_default_port() {
        let url = "mysql://admin:pwd@db.server.io/main";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.port, 3306);
    }

    #[test]
    fn parse_mariadb_scheme() {
        let url = "mariadb://user:pass@localhost/mydb";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.db_type, DatabaseType::Mysql);
    }

    #[test]
    fn parse_sqlite_url() {
        let url = "sqlite:///path/to/database.db";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.db_type, DatabaseType::Sqlite);
        assert_eq!(result.database, Some("/path/to/database.db".to_string()));
        assert_eq!(result.host, "");
        assert_eq!(result.port, 0);
    }

    #[test]
    fn parse_url_with_special_chars_in_password() {
        let url = "postgres://user:p%40ss%2Fw%3Dord@localhost/db";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.password, "p@ss/w=ord");
    }

    #[test]
    fn parse_url_with_no_database() {
        let url = "postgres://user:pass@localhost:5432";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.database, None);
    }

    #[test]
    fn parse_url_with_empty_password() {
        let url = "postgres://user@localhost/db";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.password, "");
        assert_eq!(result.username, "user");
    }

    #[test]
    fn parse_invalid_url() {
        let result = parse_connection_url("not-a-valid-url");
        assert!(result.is_err());
    }

    #[test]
    fn parse_unsupported_scheme() {
        let result = parse_connection_url("mongodb://user:pass@localhost/db");
        assert!(matches!(result, Err(ParseError::UnsupportedScheme(_))));
    }

    #[test]
    fn parse_url_missing_username() {
        let result = parse_connection_url("postgres://localhost/db");
        assert!(matches!(result, Err(ParseError::MissingUsername)));
    }

    #[test]
    fn parse_url_with_ip_address() {
        let url = "postgres://user:pass@192.168.1.100:5432/db";
        let result = parse_connection_url(url).unwrap();

        assert_eq!(result.host, "192.168.1.100");
    }
}
