//! Badges: counts photos as they come into Deadlyne and awards milestones. A photo counts when
//! it's ingested from a card, or when a folder holding it is opened for the first time; a
//! RAW+JPG pair is one photo. Per-folder high-water marks mean reopening a shoot or
//! re-ingesting a card never counts twice. Port of `Achievements.swift`, with the same badge ids.

use chrono::{Datelike, Local};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Badge {
    pub id: String,
    pub track: &'static str,
    pub threshold: u64,
    pub name: &'static str,
    /// 0 bronze, 1 silver, 2 gold, 3 elite (placeholder art only).
    pub tier: u8,
}

/// Every badge, in order. Ids are permanent: earned badges and artwork files use them.
pub fn badges() -> Vec<Badge> {
    let photos: [(u64, &str); 12] = [
        (100, "Warm-Up"), (500, "Kickoff"), (1_000, "First Thousand"), (2_500, "Game Day"), (5_000, "Starter"), (10_000, "Varsity"),
        (25_000, "All-Conference"), (50_000, "All-State"), (100_000, "Hall of Fame"), (250_000, "Legend"), (500_000, "Dynasty"),
        (1_000_000, "The Million"),
    ];
    let shoots: [(u64, &str, u8); 6] = [
        (1, "First Shoot", 0), (10, "Double Digits", 0), (25, "Season Pass", 1), (50, "Road Warrior", 1), (100, "Centurion", 2),
        (250, "Iron Lens", 3),
    ];
    let mut out: Vec<Badge> = photos
        .iter()
        .enumerate()
        .map(|(i, (t, n))| Badge { id: format!("photos-{t}"), track: "photos", threshold: *t, name: n, tier: (i / 3).min(3) as u8 })
        .collect();
    out.extend(shoots.iter().map(|(t, n, tier)| Badge { id: format!("shoots-{t}"), track: "shoots", threshold: *t, name: n, tier: *tier }));
    out
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct Month {
    pub photos: u64,
    pub shoots: u64,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug)]
pub struct State {
    pub photos: u64,
    pub shoots: u64,
    pub folders: HashMap<String, u64>,
    /// Badge id → when it was earned (Unix milliseconds).
    pub earned: HashMap<String, f64>,
    /// "2026-09" → that month's tally.
    pub months: HashMap<String, Month>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn path() -> PathBuf {
    dirs::data_dir().unwrap_or_else(std::env::temp_dir).join("Deadlyne").join("achievements.json")
}

fn load() -> State {
    if let Some(s) = std::fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
        return s;
    }
    import_from_mac_app().unwrap_or_default()
}

/// On a Mac that ran the original Swift Deadlyne, carry its progress over once.
#[cfg(target_os = "macos")]
fn import_from_mac_app() -> Option<State> {
    let prefs = dirs::home_dir()?.join("Library/Preferences/app.deadlyne.Deadlyne.plist");
    let root = plist::Value::from_file(prefs).ok()?;
    let data = root.as_dictionary()?.get("achievements")?.as_data()?;
    let v: serde_json::Value = serde_json::from_slice(data).ok()?;
    // Swift encodes dates as seconds since 2001-01-01.
    let earned = v["earned"].as_object()?.iter().filter_map(|(k, d)| Some((k.clone(), (d.as_f64()? + 978_307_200.0) * 1000.0))).collect();
    let months = v["months"]
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(k, t)| (k.clone(), Month { photos: t["photos"].as_u64().unwrap_or(0), shoots: t["shoots"].as_u64().unwrap_or(0) }))
                .collect()
        })
        .unwrap_or_default();
    let folders = v["folders"].as_object()?.iter().filter_map(|(k, n)| Some((k.clone(), n.as_u64()?))).collect();
    let s = State { photos: v["photos"].as_u64()?, shoots: v["shoots"].as_u64()?, folders, earned, months };
    save(&s);
    Some(s)
}

#[cfg(not(target_os = "macos"))]
fn import_from_mac_app() -> Option<State> {
    None
}

fn save(s: &State) {
    let p = path();
    let _ = std::fs::create_dir_all(p.parent().unwrap());
    if let Ok(bytes) = serde_json::to_vec_pretty(s) {
        let _ = crate::xmp::write_atomic(&p, &bytes);
    }
}

fn month_key() -> String {
    let now = Local::now();
    format!("{:04}-{:02}", now.year(), now.month())
}

/// Applies a change, awards any newly reached badges, saves, and returns those badges.
fn mutate(change: impl FnOnce(&mut State)) -> Vec<Badge> {
    let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
    let s = guard.get_or_insert_with(load);
    change(s);
    let now = Local::now().timestamp_millis() as f64;
    let mut unlocked = vec![];
    for b in badges() {
        let value = if b.track == "photos" { s.photos } else { s.shoots };
        if value >= b.threshold && !s.earned.contains_key(&b.id) {
            s.earned.insert(b.id.clone(), now);
            unlocked.push(b);
        }
    }
    save(s);
    unlocked
}

fn normalize(folder: &str) -> String {
    folder.trim_end_matches(['/', '\\']).to_string()
}

/// A folder was opened holding `count` photos; only photos beyond what was counted before are added.
pub fn record_folder(folder: &str, count: u64) -> Vec<Badge> {
    let key = normalize(folder);
    mutate(|s| {
        let old = s.folders.get(&key).copied();
        if count <= old.unwrap_or(0) {
            return;
        }
        let new_shoot = old.is_none();
        s.folders.insert(key, count);
        let added = count - old.unwrap_or(0);
        s.photos += added;
        s.shoots += new_shoot as u64;
        let m = s.months.entry(month_key()).or_default();
        m.photos += added;
        m.shoots += new_shoot as u64;
    })
}

/// Photos copied by an ingest, per destination folder.
pub fn record_ingest(per_folder: &HashMap<String, u64>) -> Vec<Badge> {
    mutate(|s| {
        for (folder, n) in per_folder.iter().filter(|(_, n)| **n > 0) {
            let key = normalize(folder);
            let new_shoot = !s.folders.contains_key(&key);
            *s.folders.entry(key).or_default() += n;
            s.photos += n;
            s.shoots += new_shoot as u64;
            let m = s.months.entry(month_key()).or_default();
            m.photos += n;
            m.shoots += new_shoot as u64;
        }
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub photos: u64,
    pub shoots: u64,
    pub month: Month,
    pub badges: Vec<Badge>,
    pub earned: HashMap<String, f64>,
}

#[tauri::command]
pub async fn achievements() -> Summary {
    crate::jobs::blocking(|| {
        let mut guard = STATE.lock().unwrap_or_else(|e| e.into_inner());
        let s = guard.get_or_insert_with(load);
        Summary {
            photos: s.photos,
            shoots: s.shoots,
            month: s.months.get(&month_key()).cloned().unwrap_or_default(),
            badges: badges(),
            earned: s.earned.clone(),
        }
    })
    .await
}

/// Called when a folder is opened. Returns badges unlocked by it.
#[tauri::command]
pub async fn record_folder_opened(folder: String, photos: u64) -> Vec<Badge> {
    crate::jobs::blocking(move || record_folder(&folder, photos)).await
}
