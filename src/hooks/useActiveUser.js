import { useState, useEffect, useCallback } from 'react';
import { getUsers, getActiveUser, setActiveUser } from '../data/users';

/**
 * useActiveUser()
 *
 * Returns the active user profile and a stable switchUser function.
 * Reacts to 'smartMirror:activeUserChanged' events so any component
 * that calls this hook updates automatically when another part of the
 * app switches the user.
 *
 * Usage:
 *   const { activeUser, allUsers, switchUser } = useActiveUser();
 *
 * Future:
 *   activeUser.gmailConnected  → drive per-user Gmail widget
 *   activeUser.spotifyConnected → drive per-user Spotify widget
 */
const useActiveUser = () => {
  const [usersState, setUsersState] = useState(() => getUsers());

  // Re-read from localStorage whenever another component or the phone sync
  // layer fires 'smartMirror:activeUserChanged' or the generic 'storage' event.
  useEffect(() => {
    const refresh = () => setUsersState(getUsers());
    window.addEventListener('smartMirror:activeUserChanged', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('smartMirror:activeUserChanged', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const switchUser = useCallback((userId) => {
    setActiveUser(userId);
    setUsersState(getUsers());
  }, []);

  const activeUser =
    usersState.profiles.find(p => p.id === usersState.activeUserId) ||
    usersState.profiles[0] ||
    null;

  return {
    activeUser,
    allUsers: usersState.profiles,
    activeUserId: usersState.activeUserId,
    switchUser
  };
};

export default useActiveUser;
