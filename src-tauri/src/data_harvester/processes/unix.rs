//! Unix-specific parts of process collection.

use std::{ffi::CStr, io, mem::MaybeUninit, ptr};

use fxhash::FxHashMap;

use crate::utils::error;

const INITIAL_PASSWD_BUFFER_SIZE: usize = 1024;
const MAX_PASSWD_BUFFER_SIZE: usize = 1024 * 1024;

#[derive(Debug, Default)]
pub struct UserTable {
    pub uid_user_mapping: FxHashMap<libc::uid_t, String>,
}

impl UserTable {
    pub fn get_uid_to_username_mapping(&mut self, uid: libc::uid_t) -> error::Result<String> {
        self.get_or_lookup(uid, lookup_username).map_err(Into::into)
    }

    fn get_or_lookup(
        &mut self,
        uid: libc::uid_t,
        mut lookup: impl FnMut(libc::uid_t, &mut [u8]) -> io::Result<Option<String>>,
    ) -> io::Result<String> {
        if let Some(user) = self.uid_user_mapping.get(&uid) {
            return Ok(user.clone());
        }

        let mut buffer = vec![0; INITIAL_PASSWD_BUFFER_SIZE];
        loop {
            match lookup(uid, &mut buffer) {
                Ok(Some(username)) => {
                    self.uid_user_mapping.insert(uid, username.clone());
                    return Ok(username);
                }
                Ok(None) => return Err(io::Error::new(io::ErrorKind::NotFound, "Missing passwd")),
                Err(err)
                    if err.raw_os_error() == Some(libc::ERANGE)
                        && buffer.len() < MAX_PASSWD_BUFFER_SIZE =>
                {
                    // NSS records can exceed the initial buffer. Bound growth so a
                    // failed lookup cannot allocate or retry indefinitely.
                    buffer.resize((buffer.len() * 2).min(MAX_PASSWD_BUFFER_SIZE), 0);
                }
                Err(err) => return Err(err),
            }
        }
    }
}

fn lookup_username(uid: libc::uid_t, buffer: &mut [u8]) -> io::Result<Option<String>> {
    let mut passwd = MaybeUninit::<libc::passwd>::uninit();
    let mut result = ptr::null_mut();
    // SAFETY: passwd and result are writable, and buffer is exclusively borrowed
    // for this call. getpwuid_r uses this caller-owned storage, unlike getpwuid's
    // shared static record. The supplied length is the buffer's actual size.
    let status = unsafe {
        libc::getpwuid_r(
            uid,
            passwd.as_mut_ptr(),
            buffer.as_mut_ptr().cast(),
            buffer.len(),
            &mut result,
        )
    };
    if status != 0 {
        return Err(io::Error::from_raw_os_error(status));
    }
    if result.is_null() {
        return Ok(None);
    }

    // SAFETY: a successful call with a non-null result initializes passwd.
    let passwd = unsafe { passwd.assume_init() };
    if passwd.pw_name.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "Missing passwd name",
        ));
    }
    // SAFETY: the successful lookup supplies a NUL-terminated name in buffer,
    // which remains alive and unchanged until the string has been copied.
    let username = unsafe { CStr::from_ptr(passwd.pw_name) }
        .to_str()
        .map_err(|err| io::Error::new(io::ErrorKind::InvalidData, err))?
        .to_owned();
    Ok(Some(username))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grows_small_buffers_and_caches_only_owned_successes() {
        let mut users = UserTable::default();
        let mut sizes = Vec::new();
        let username = users
            .get_or_lookup(42, |uid, buffer| {
                assert_eq!(uid, 42);
                sizes.push(buffer.len());
                if sizes.len() == 1 {
                    Err(io::Error::from_raw_os_error(libc::ERANGE))
                } else {
                    Ok(Some("alice".to_owned()))
                }
            })
            .unwrap();
        assert_eq!(
            sizes,
            [INITIAL_PASSWD_BUFFER_SIZE, INITIAL_PASSWD_BUFFER_SIZE * 2]
        );
        assert_eq!(username, "alice");
        let mut cached = users
            .get_or_lookup(42, |_, _| panic!("cached users must not call NSS"))
            .unwrap();
        cached.clear();
        assert_eq!(users.uid_user_mapping.get(&42).unwrap(), "alice");
    }

    #[test]
    fn missing_users_and_non_range_errors_are_retried_on_later_lookups() {
        let mut users = UserTable::default();
        for raw_error in [None, Some(libc::EIO), Some(libc::EINTR)] {
            let mut calls = 0;
            let err = users
                .get_or_lookup(42, |_, _| {
                    calls += 1;
                    match raw_error {
                        Some(code) => Err(io::Error::from_raw_os_error(code)),
                        None => Ok(None),
                    }
                })
                .unwrap_err();
            assert_eq!(calls, 1);
            assert!(users.uid_user_mapping.is_empty());
            if let Some(code) = raw_error {
                assert_eq!(err.raw_os_error(), Some(code));
            } else {
                assert_eq!(err.kind(), io::ErrorKind::NotFound);
            }
        }
        assert_eq!(
            users
                .get_or_lookup(42, |_, _| Ok(Some("recovered".to_owned())))
                .unwrap(),
            "recovered"
        );
    }

    #[test]
    fn oversized_records_stop_at_the_buffer_limit_and_can_recover() {
        let mut users = UserTable::default();
        let mut sizes = Vec::new();
        let err = users
            .get_or_lookup(42, |_, buffer| {
                // Fail the test promptly if the growth limit regresses.
                assert!(sizes.len() < 20);
                sizes.push(buffer.len());
                Err(io::Error::from_raw_os_error(libc::ERANGE))
            })
            .unwrap_err();
        assert_eq!(err.raw_os_error(), Some(libc::ERANGE));
        assert_eq!(sizes.last(), Some(&MAX_PASSWD_BUFFER_SIZE));
        assert!(sizes.windows(2).all(|pair| pair[1] > pair[0]));
        assert!(sizes.iter().all(|size| *size <= MAX_PASSWD_BUFFER_SIZE));
        assert!(users.uid_user_mapping.is_empty());
        assert_eq!(
            users
                .get_or_lookup(42, |_, _| Ok(Some("recovered".to_owned())))
                .unwrap(),
            "recovered"
        );
    }

    #[test]
    fn native_lookup_copies_the_name_before_reusing_storage() {
        // UID 0 is the root account on the supported Unix CI hosts. Do not
        // assume its name, since account databases can use a different one.
        let mut buffer = vec![0; MAX_PASSWD_BUFFER_SIZE];
        let username = lookup_username(0, &mut buffer).unwrap().unwrap();
        assert!(!username.is_empty());
        let expected = username.clone();
        buffer.fill(0);
        assert_eq!(username, expected);

        let mut users = UserTable::default();
        assert_eq!(users.get_uid_to_username_mapping(0).unwrap(), expected);
    }
}
