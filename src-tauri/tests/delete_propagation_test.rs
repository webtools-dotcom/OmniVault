use rusqlite::Connection;

use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{create_item, delete_item, get_item_by_id, set_item_pin};
use omnivault_lib::sync::protocol::{apply_remote_revisions, query_revisions_since};

fn node(dev: &str) -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    let _ = dev;
    conn
}

/// A delete on one device must reach the other. This is the whole premise of a
/// sync engine: if "delete" does not replicate, the vault silently diverges.
#[test]
fn deleting_an_item_propagates_to_a_peer() {
    let mut phone = node("phone");
    let mut laptop = node("laptop");

    // Phone creates a note and the laptop catches up.
    let item = create_item(&mut phone, None, "note", "throwaway", "text", None, "phone").unwrap();
    let deltas = query_revisions_since(&phone, 0, None).unwrap();
    apply_remote_revisions(&mut laptop, &deltas).unwrap();
    assert!(
        get_item_by_id(&laptop, &item.id).unwrap().is_some(),
        "precondition: the laptop should have received the note"
    );

    // Phone deletes it.
    let before_delete = chrono::Utc::now().timestamp_millis() - 1;
    delete_item(&mut phone, &item.id, "phone").unwrap();

    // Laptop syncs only what is new.
    let deltas = query_revisions_since(&phone, before_delete, None).unwrap();
    assert!(
        deltas.iter().any(|r| r.change_type == "deleted"),
        "the phone must emit a delete revision"
    );
    apply_remote_revisions(&mut laptop, &deltas).unwrap();

    let on_laptop = get_item_by_id(&laptop, &item.id).unwrap();
    assert!(
        on_laptop.is_none() || on_laptop.unwrap().is_deleted,
        "the deleted note must not still be alive on the laptop"
    );
}

/// Pinning is the same shape: a state change recorded with an empty payload.
#[test]
fn pinning_an_item_propagates_to_a_peer() {
    let mut phone = node("phone");
    let mut laptop = node("laptop");

    let item = create_item(&mut phone, None, "note", "keeper", "text", None, "phone").unwrap();
    let deltas = query_revisions_since(&phone, 0, None).unwrap();
    apply_remote_revisions(&mut laptop, &deltas).unwrap();

    let before = chrono::Utc::now().timestamp_millis() - 1;
    set_item_pin(&mut phone, &item.id, true, "phone").unwrap();
    let deltas = query_revisions_since(&phone, before, None).unwrap();
    apply_remote_revisions(&mut laptop, &deltas).unwrap();

    assert!(
        get_item_by_id(&laptop, &item.id)
            .unwrap()
            .unwrap()
            .is_pinned,
        "the pin must reach the laptop"
    );
}

/// Deleting a folder cascades to descendants and rescues their items to the
/// inbox. All of that must reach the peer, or the two devices disagree about
/// where the user's notes live.
#[test]
fn deleting_a_folder_propagates_with_its_descendants_and_rescued_items() {
    use omnivault_lib::db::storage::{create_folder, delete_folder, list_folders};

    let mut phone = node("phone");
    let mut laptop = node("laptop");

    let parent = create_folder(&mut phone, "Research", None, None, "phone").unwrap();
    let child = create_folder(&mut phone, "Sub", Some(&parent.id), None, "phone").unwrap();
    let note = create_item(
        &mut phone,
        Some(&child.id),
        "note",
        "inside",
        "x",
        None,
        "phone",
    )
    .unwrap();

    let deltas = query_revisions_since(&phone, 0, None).unwrap();
    apply_remote_revisions(&mut laptop, &deltas).unwrap();
    assert_eq!(
        list_folders(&laptop, false).unwrap().len(),
        2,
        "precondition: both folders synced"
    );

    let before = chrono::Utc::now().timestamp_millis() - 1;
    delete_folder(&mut phone, &parent.id, "phone").unwrap();

    let deltas = query_revisions_since(&phone, before, None).unwrap();
    apply_remote_revisions(&mut laptop, &deltas).unwrap();

    assert_eq!(
        list_folders(&laptop, false).unwrap().len(),
        0,
        "both the folder and its subfolder must be gone on the laptop"
    );
    let rescued = get_item_by_id(&laptop, &note.id).unwrap().unwrap();
    assert!(
        !rescued.is_deleted,
        "the note itself must survive the folder deletion"
    );
    assert_eq!(
        rescued.folder_id, None,
        "the note must be rescued to Quick Inbox on the laptop too, not left pointing at a deleted folder"
    );
}
