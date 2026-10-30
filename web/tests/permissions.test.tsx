import { useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, createRootRoute, RouterProvider } from '@tanstack/react-router';
import { can } from '../src/lib/auth';
import { UserAccessEditor, defaultAccess } from '../src/components/user-access-editor';
import { demoPermissionCatalog as catalog } from '../src/api/demo-permissions';
import type { Me, UserAccess } from '../src/api/types';
import { api } from '../src/api/client';
import { routeTree } from '../src/routeTree.gen';
import { adminUser, renderWithUser } from '../src/test/auth';
import { ServerQuickActions } from '../src/components/server-quick-actions';
import { ServerSettings } from '../src/components/server-settings';

const viewer: Me = { id: 'viewer', email: 'viewer@example.test', role: 'viewer', permissions: catalog.roles.find((r) => r.id === 'viewer')!.permissions, server_ids: ['demo'], all_servers: false, disabled: false };

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe('permission presentation', () => {
  it('denies absent accounts, missing capabilities, disabled accounts and foreign servers', () => {
    expect(can(null, 'servers.view')).toBe(false);
    expect(can({ id: 'old', email: 'old@example.test' }, 'users.manage')).toBe(false);
    expect(can(viewer, 'console.read', 'demo')).toBe(true);
    expect(can(viewer, 'console.read', 'other')).toBe(false);
    expect(can(viewer, 'console.write', 'demo')).toBe(false);
    expect(can({ ...viewer, disabled: true }, 'console.read', 'demo')).toBe(false);
    expect(can(adminUser, 'users.manage')).toBe(true);
  });

  it('blocks server copying without its additional capabilities', () => {
    const custom: Me = { ...viewer, role: 'custom', all_servers: true, permissions: ['servers.view', 'servers.copy'] };
    expect(can(custom, 'servers.copy', 'demo')).toBe(false);
    expect(can({ ...custom, permissions: [...custom.permissions!, 'servers.create', 'files.read'] }, 'servers.copy', 'demo')).toBe(true);
  });

  it('keeps power controls disabled for a viewer', async () => {
    const route = createRootRoute({ component: () => <ServerQuickActions server={{ id: 'demo', name: 'Demo', state: 'running' } as never} onCopy={() => {}} onUpdated={() => {}} /> });
    const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ['/'] }) });
    renderWithUser(<RouterProvider router={router} />, viewer);
    expect(await screen.findByRole('button', { name: 'Stop Demo' })).toBeDisabled();
  });
});

describe('resource permission', () => {
  const server = { id: 'demo', name: 'Demo', server_type: 'paper', version: '1.21.4', build: '145', ram_mb: 2048, cpu_limit: 0, memory_limit_mb: 0, host_port: 25565, extra_ports: [], container_id: '', state: 'stopped', created_at: '', updated_at: '' } as never;
  const operator: Me = { ...viewer, role: 'operator', permissions: catalog.roles.find((r) => r.id === 'operator')!.permissions };

  async function renderSettings(user: Me) {
    vi.spyOn(api, 'javaVersions').mockResolvedValue([]);
    vi.spyOn(api, 'listServers').mockResolvedValue([]);
    vi.spyOn(api, 'availablePorts').mockResolvedValue({ available: [], used: [] });
    renderWithUser(<ServerSettings server={server} onSaved={() => {}} />, user);
    // Let the settings form finish loading ports and Java versions.
    await act(async () => {});
  }

  it('locks memory and ports for operators but keeps configuration editable', async () => {
    await renderSettings(operator);
    expect(screen.getByLabelText('Name')).toBeEnabled();
    expect(screen.getByLabelText('RAM (MB)')).toBeDisabled();
    expect(screen.getByLabelText('Game port (host)')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add port/ })).toBeDisabled();
    expect(screen.getByText('Memory, CPU, and ports need the Change resources permission.')).toBeInTheDocument();
  });

  it('allows resource changes for administrators', async () => {
    await renderSettings(adminUser);
    expect(screen.getByLabelText('RAM (MB)')).toBeEnabled();
    expect(screen.queryByText(/need the Change resources permission/)).not.toBeInTheDocument();
  });

  it('adds edit configuration when granting resources in the editor', async () => {
    render(<Editor initial={{ ...defaultAccess(), role: 'custom' }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /^Change resources / }));
    expect(JSON.parse(screen.getByTestId('access').textContent!).permissions).toEqual(expect.arrayContaining(['servers.view', 'servers.edit', 'servers.resources']));
    await userEvent.click(screen.getByRole('checkbox', { name: /^Edit configuration / }));
    expect(JSON.parse(screen.getByTestId('access').textContent!).permissions).not.toContain('servers.resources');
  });
});

function Editor({ initial = defaultAccess() }: { initial?: UserAccess }) {
  const [access, setAccess] = useState(initial);
  return <><UserAccessEditor value={access} onChange={setAccess} catalog={catalog} /><output data-testid="access">{JSON.stringify(access)}</output></>;
}

it('starts with no assigned servers and retains selected server access', async () => {
  render(<Editor />);
  expect(screen.getByRole('checkbox', { name: 'Mega SMP Server' })).not.toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Mega SMP Server' }));
  expect(JSON.parse(screen.getByTestId('access').textContent!).server_ids).toEqual(['demo']);
  await userEvent.click(screen.getByRole('checkbox', { name: 'All current and future servers' }));
  expect(JSON.parse(screen.getByTestId('access').textContent!)).toMatchObject({ all_servers: true, server_ids: [] });
});

it('adds scheduling prerequisites and filters the permission list', async () => {
  render(<Editor initial={{ ...defaultAccess(), role: 'custom' }} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /^Manage schedules / }));
  expect(JSON.parse(screen.getByTestId('access').textContent!).permissions).toEqual(expect.arrayContaining(['servers.view', 'schedules.manage', 'servers.power', 'console.write', 'backups.create']));
  await userEvent.type(screen.getByRole('textbox', { name: 'Filter permissions' }), 'operator');
  expect(screen.getByRole('checkbox', { name: /^Manage operators / })).toBeVisible();
  expect(screen.queryByRole('checkbox', { name: /^Delete files / })).not.toBeInTheDocument();
});

it('makes server creation require all-server scope in the editor', async () => {
  render(<Editor initial={{ ...defaultAccess(), role: 'custom' }} />);
  await userEvent.click(screen.getByRole('checkbox', { name: /^Create servers / }));
  expect(JSON.parse(screen.getByTestId('access').textContent!)).toMatchObject({ all_servers: true, permissions: expect.arrayContaining(['servers.view', 'servers.create']) });
  expect(screen.getByRole('checkbox', { name: 'All current and future servers' })).toBeDisabled();
});

async function openUsers(user: Me) {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(api, 'me').mockResolvedValue(user);
  vi.spyOn(api, 'listUsers').mockResolvedValue([{ ...adminUser, totp_enabled: false, created_at: '2026-01-01', updated_at: '2026-01-01' }]);
  vi.spyOn(api, 'permissionCatalog').mockResolvedValue(catalog);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/users'] }), defaultPendingMinMs: 0 });
  render(<RouterProvider router={router} />);
}

it('restricts the user management page and does not request account data for viewers', async () => {
  await openUsers(viewer);
  expect(await screen.findByRole('heading', { name: 'Access restricted' })).toBeVisible();
  expect(api.listUsers).not.toHaveBeenCalled();
  expect(api.permissionCatalog).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
});

it('sends the selected access policy when creating a user', async () => {
  await openUsers(adminUser);
  const create = vi.spyOn(api, 'createUser').mockResolvedValue({ ...viewer, created_at: '', updated_at: '', totp_enabled: false });
  await screen.findByRole('checkbox', { name: 'Mega SMP Server' });
  await userEvent.type(screen.getByLabelText('Email'), 'new@example.test');
  await userEvent.type(screen.getByLabelText('Password'), 'password123');
  await userEvent.click(screen.getByRole('checkbox', { name: 'Mega SMP Server' }));
  await userEvent.click(screen.getByRole('button', { name: 'Create user' }));
  await waitFor(() => expect(create).toHaveBeenCalledWith('new@example.test', 'password123', { ...defaultAccess(), server_ids: ['demo'] }));
  expect(await screen.findByRole('status')).toHaveTextContent('User created.');
});
