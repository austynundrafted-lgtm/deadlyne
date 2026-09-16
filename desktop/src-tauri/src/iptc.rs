//! The caption fields Deadlyne edits, mapped to the standard IPTC-in-XMP properties that
//! Lightroom, Photo Mechanic, Photoshop and newsroom systems read. Port of `IPTC.swift`.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    Headline,
    Caption,
    Keywords,
    Event,
    Location,
    City,
    State,
    Country,
    Creator,
    Credit,
    Copyright,
    /// IPTC Title / IIM Object Name: a short slug such as "FBO-Tecumseh-Fairborn".
    Title,
    /// By-line Title: "Staff Photographer", "Contributor".
    BylineTitle,
    Source,
    /// Special instructions for the desk: embargoes, corrections, "Refiled with corrected name".
    Instructions,
    /// Job Identifier / IIM Transmission Reference, e.g. an assignment number.
    JobId,
    CaptionWriter,
    CountryCode,
    UsageTerms,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Simple,
    LangAlt,
    Bag,
    Seq,
}

impl Field {
    pub const ALL: [Field; 19] = [
        Field::Headline,
        Field::Caption,
        Field::Keywords,
        Field::Event,
        Field::Location,
        Field::City,
        Field::State,
        Field::Country,
        Field::Creator,
        Field::Credit,
        Field::Copyright,
        Field::Title,
        Field::BylineTitle,
        Field::Source,
        Field::Instructions,
        Field::JobId,
        Field::CaptionWriter,
        Field::CountryCode,
        Field::UsageTerms,
    ];

    pub fn prefix(self) -> &'static str {
        match self {
            Field::Caption | Field::Keywords | Field::Creator | Field::Copyright | Field::Title => "dc",
            Field::Headline
            | Field::City
            | Field::State
            | Field::Country
            | Field::Credit
            | Field::BylineTitle
            | Field::Source
            | Field::Instructions
            | Field::JobId
            | Field::CaptionWriter => "photoshop",
            Field::Location | Field::CountryCode => "Iptc4xmpCore",
            Field::Event => "Iptc4xmpExt",
            Field::UsageTerms => "xmpRights",
        }
    }

    pub fn namespace(self) -> &'static str {
        match self.prefix() {
            "dc" => "http://purl.org/dc/elements/1.1/",
            "photoshop" => "http://ns.adobe.com/photoshop/1.0/",
            "Iptc4xmpCore" => "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
            "xmpRights" => "http://ns.adobe.com/xap/1.0/rights/",
            _ => "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
        }
    }

    fn name(self) -> &'static str {
        match self {
            Field::Headline => "Headline",
            Field::Caption => "description",
            Field::Keywords => "subject",
            Field::Event => "Event",
            Field::Location => "Location",
            Field::City => "City",
            Field::State => "State",
            Field::Country => "Country",
            Field::Creator => "creator",
            Field::Credit => "Credit",
            Field::Copyright => "rights",
            Field::Title => "title",
            Field::BylineTitle => "AuthorsPosition",
            Field::Source => "Source",
            Field::Instructions => "Instructions",
            Field::JobId => "TransmissionReference",
            Field::CaptionWriter => "CaptionWriter",
            Field::CountryCode => "CountryCode",
            Field::UsageTerms => "UsageTerms",
        }
    }

    pub fn kind(self) -> Kind {
        match self {
            Field::Caption | Field::Event | Field::Copyright | Field::Title | Field::UsageTerms => Kind::LangAlt,
            Field::Keywords => Kind::Bag,
            Field::Creator => Kind::Seq,
            _ => Kind::Simple,
        }
    }

    pub fn xmp_path(self) -> String {
        format!("{}:{}", self.prefix(), self.name())
    }
}

/// One photo's captions. Empty strings mean "not set".
#[derive(Serialize, Deserialize, Clone, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Captions {
    pub headline: String,
    pub caption: String,
    pub keywords: Vec<String>,
    pub event: String,
    pub location: String,
    pub city: String,
    pub state: String,
    pub country: String,
    pub creator: String,
    pub credit: String,
    pub copyright: String,
    pub title: String,
    pub byline_title: String,
    pub source: String,
    pub instructions: String,
    pub job_id: String,
    pub caption_writer: String,
    pub country_code: String,
    pub usage_terms: String,
}

impl Captions {
    pub fn get(&self, f: Field) -> String {
        match f {
            Field::Headline => self.headline.clone(),
            Field::Caption => self.caption.clone(),
            Field::Keywords => self.keywords.join(", "),
            Field::Event => self.event.clone(),
            Field::Location => self.location.clone(),
            Field::City => self.city.clone(),
            Field::State => self.state.clone(),
            Field::Country => self.country.clone(),
            Field::Creator => self.creator.clone(),
            Field::Credit => self.credit.clone(),
            Field::Copyright => self.copyright.clone(),
            Field::Title => self.title.clone(),
            Field::BylineTitle => self.byline_title.clone(),
            Field::Source => self.source.clone(),
            Field::Instructions => self.instructions.clone(),
            Field::JobId => self.job_id.clone(),
            Field::CaptionWriter => self.caption_writer.clone(),
            Field::CountryCode => self.country_code.clone(),
            Field::UsageTerms => self.usage_terms.clone(),
        }
    }

    pub fn set(&mut self, f: Field, value: &str) {
        let v = value.trim().to_string();
        match f {
            Field::Headline => self.headline = v,
            Field::Caption => self.caption = v,
            Field::Keywords => self.keywords = split_keywords(&v),
            Field::Event => self.event = v,
            Field::Location => self.location = v,
            Field::City => self.city = v,
            Field::State => self.state = v,
            Field::Country => self.country = v,
            Field::Creator => self.creator = v,
            Field::Credit => self.credit = v,
            Field::Copyright => self.copyright = v,
            Field::Title => self.title = v,
            Field::BylineTitle => self.byline_title = v,
            Field::Source => self.source = v,
            Field::Instructions => self.instructions = v,
            Field::JobId => self.job_id = v,
            Field::CaptionWriter => self.caption_writer = v,
            Field::CountryCode => self.country_code = v,
            Field::UsageTerms => self.usage_terms = v,
        }
    }

    pub fn is_empty(&self) -> bool {
        Field::ALL.iter().all(|f| self.get(*f).is_empty())
    }
}

/// "Tecumseh, football; Ohio" → ["Tecumseh", "football", "Ohio"], without case-insensitive duplicates.
pub fn split_keywords(s: &str) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    s.split([',', ';', '\n'])
        .map(str::trim)
        .filter(|k| !k.is_empty() && seen.insert(k.to_lowercase()))
        .map(String::from)
        .collect()
}
