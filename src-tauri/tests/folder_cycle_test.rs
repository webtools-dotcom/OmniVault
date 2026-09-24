use omnivault_lib::db::schema::initialize_schema;
use omnivault_lib::db::storage::{
    create_folder, create_item, delete_folder, list_folders, move_folder,
};
use rusqlite::Connection;

fn node() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    initialize_schema(&conn).unwrap();
    conn
}

/// A folder must never become its own ancestor, whichever API moves it.
#[test]
fn a_folder_cannot_be_moved_inside_its_own_descendant() {
    let mut c = node();
    let parent = create_folder(&mut c, "Parent", None, None, "d").unwrap();
    let child = create_folder(&mut c, "Child", Some(&parent.id), None, "d").unwrap();

    let res = move_folder(&mut c, &parent.id, Some(&child.id), "d");
    assert!(
        res.is_err(),
        "moving a folder into its own child must be rejected"
    );

    let parent_now = list_folders(&c, false)
        .unwrap()
        .into_iter()
        .find(|f| f.id == parent.id)
        .unwrap();
    assert_eq!(
        parent_now.parent_id, None,
        "the rejected move must not have been applied"
    );
}

#[test]
fn a_folder_cannot_be_moved_into_itself() {
    let mut c = node();
    let f = create_folder(&mut c, "Solo", None, None, "d").unwrap();
    assert!(
        move_folder(&mut c, &f.id, Some(&f.id), "d").is_err(),
        "a folder must not be its own parent"
    );
}

/// Deleting a tree must terminate and rescue items even several levels down.
#[test]
fn deleting_a_deep_tree_terminates_and_rescues_items() {
    let mut c = node();
    let a = create_folder(&mut c, "A", None, None, "d").unwrap();
    let b = create_folder(&mut c, "B", Some(&a.id), None, "d").unwrap();
    let cc = create_folder(&mut c, "C", Some(&b.id), None, "d").unwrap();
    let note = create_item(&mut c, Some(&cc.id), "note", "deep", "x", None, "d").unwrap();

    delete_folder(&mut c, &a.id, "d").unwrap();

    assert_eq!(
        list_folders(&c, false).unwrap().len(),
        0,
        "the whole subtree is deleted"
    );
    let n = omnivault_lib::db::storage::get_item_by_id(&c, &note.id)
        .unwrap()
        .unwrap();
    assert!(
        !n.is_deleted && n.folder_id.is_none(),
        "the deep note is rescued to the inbox"
    );
}
