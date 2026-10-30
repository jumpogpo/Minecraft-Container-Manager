-- Resource changes moved out of servers.edit into servers.resources. Custom
-- accounts that could edit configuration keep the access they had.
UPDATE users SET permissions = json_insert(permissions, '$[#]', 'servers.resources')
WHERE role = 'custom'
  AND EXISTS (SELECT 1 FROM json_each(users.permissions) WHERE value = 'servers.edit')
  AND NOT EXISTS (SELECT 1 FROM json_each(users.permissions) WHERE value = 'servers.resources');
