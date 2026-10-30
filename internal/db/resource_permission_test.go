package db

import (
	"path/filepath"
	"testing"
)

func TestResourcePermissionMigrationKeepsCustomAccess(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-permissions.db")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.DB.Exec(`
		DELETE FROM schema_migrations WHERE name='0025_resource_permission.sql';
		INSERT INTO users (id,email,password_hash,role,permissions,created_at,updated_at) VALUES
		('editor','editor@example.test','hash','custom','["servers.edit","servers.view"]','now','now'),
		('viewer','viewer@example.test','hash','custom','["servers.view"]','now','now'),
		('operator','operator@example.test','hash','operator','[]','now','now');
	`)
	store.Close()
	if err != nil {
		t.Fatal(err)
	}
	for run := 0; run < 2; run++ {
		upgraded, err := Open(path)
		if err != nil {
			t.Fatal(err)
		}
		for id, want := range map[string]string{
			"editor":   `["servers.edit","servers.view","servers.resources"]`,
			"viewer":   `["servers.view"]`,
			"operator": `[]`,
		} {
			var got string
			if err := upgraded.DB.QueryRow(`SELECT permissions FROM users WHERE id=?`, id).Scan(&got); err != nil || got != want {
				t.Fatalf("%s permissions after migration: %q err=%v", id, got, err)
			}
		}
		upgraded.Close()
	}
}
