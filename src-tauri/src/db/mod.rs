pub mod models;
pub mod schema;

use rusqlite::{Connection, Result};
use std::path::Path;

pub fn open_or_create_db<P: AsRef<Path>>(path: P) -> Result<Connection> {
    let conn = Connection::open(path)?;
    schema::initialize_schema(&conn)?;
    Ok(conn)
}
