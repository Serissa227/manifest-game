use super::*;
impl World {
    pub fn act_presence(&self, person: &str) -> Option<&str> {
        self.state.upbringing.as_ref()?.act.presence.get(person).map(String::as_str)
    }
    pub(super) fn act_home_place(&self) -> Option<&str> {
        let venue = if self.upbringing_academy().is_some() { "dorm" } else { "home" };
        self.act_places()
            .iter()
            .filter(|p| p.venue == venue && self.upbringing_place_open(p))
            .min_by_key(|p| &p.key)
            .or_else(|| self.act_places().iter().filter(|p| self.upbringing_place_open(p)).min_by_key(|p| &p.key))
            .map(|p| p.key.as_str())
    }
    pub(super) fn act_refresh_presence(&mut self) {
        if let Some(leg) = self.act_voyage_leg() {
            let people = leg.people.clone();
            if let Some(s) = &mut self.state.upbringing {
                s.act.presence = people;
            }
            return;
        }
        let mut people =
            self.upbringing_family().map(|f| f.companions.keys().cloned().collect::<BTreeSet<_>>()).unwrap_or_default();
        if let Some(a) = self.upbringing_academy() {
            people.extend(a.companions.keys().cloned());
        }
        let protagonist = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        let mut date = self.cast_date();
        date[2] = weekly::week_start(weekly::week_of(date[2])) + 6;
        let aliases = self
            .upbringing_academy()
            .map(|a| &a.venue_aliases)
            .or_else(|| self.upbringing_family().map(|f| &f.venue_aliases));
        let mut presence = people
            .into_iter()
            .filter(|p| Some(p.as_str()) != protagonist)
            .filter_map(|person| {
                let at = self.upbringing_person_on(&person, date)?;
                if Some(at.loc) != self.upbringing_location() {
                    return None;
                }
                let find = |venue: &str| self.act_places().iter().filter(|p| p.venue == venue).min_by_key(|p| &p.key);
                let place = find(&at.venue)
                    .or_else(|| aliases.and_then(|a| a.get(&at.venue)).and_then(|v| find(v)))
                    .filter(|p| self.upbringing_place_open(p))
                    .map(|p| p.key.as_str())
                    .or_else(|| self.act_home_place())?;
                Some((person, place.to_owned()))
            })
            .collect();
        self.act_tide_presence(&mut presence);
        if let Some(s) = &mut self.state.upbringing {
            s.act.presence = presence;
        }
    }
}
