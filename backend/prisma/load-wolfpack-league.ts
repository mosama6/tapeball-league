/**
 * Wipe competition data and load Wolfpack Tape Ball League squads + group fixtures.
 * Keeps User and GalleryImage rows.
 *
 *   DATABASE_URL="..." npx tsx prisma/load-wolfpack-league.ts
 */
import { prisma } from "../src/db.js";

const TEAMS: {
  name: string;
  captain: string;
  players: string[];
}[] = [
  {
    name: "Bheriye",
    captain: "Affer Raza",
    players: [
      "Affer Raza",
      "Farooq Asif",
      "Ahmad Shahzad",
      "Osama Shahbaz",
      "Muhammad Usman",
      "Tabish Munir",
      "Sheikh Fahad Abdullah",
      "Usama Awan"
    ]
  },
  {
    name: "Cheetay",
    captain: "Umair Azam",
    players: [
      "Umair Azam",
      "Jahanzaib Gillani",
      "Arfa bin Saqib",
      "Faizan Absar",
      "Salman Raja",
      "Bilal Qazi",
      "Maaz Senator",
      "Hassan Parvaiz"
    ]
  },
  {
    name: "Bhaalu",
    captain: "Abdur Rehman Mano",
    players: [
      "Abdur Rehman Mano",
      "Musa Mir",
      "Saad Salman",
      "Rawal Gillani",
      "Hassan Tauseef HT",
      "Arbaz Gillani",
      "Moeez Gillani",
      "Usman Shankar"
    ]
  },
  {
    name: "Gorillay",
    captain: "Sarmad Gillani",
    players: [
      "Sarmad Gillani",
      "Fraz Mirza",
      "Safwan",
      "Zain Raza",
      "Usman Wains",
      "Badar Maqsood",
      "Waleed",
      "Ibrahim Concrete"
    ]
  },
  {
    name: "Zarafay",
    captain: "Tabrez Gillani",
    players: [
      "Tabrez Gillani",
      "Asad Ranjha",
      "Hamza Mazhar",
      "Nadir Shahzad",
      "Hamza Gillani",
      "Saim Gillani",
      "Usman Warraich",
      "Ahmed Gillani"
    ]
  }
];

/** Pakistan time, 21 Aug 2026 evening through 22 Aug 00:30. */
const FIXTURES: { at: string; team1: string; team2: string }[] = [
  { at: "2026-08-21T18:30:00+05:00", team1: "Cheetay", team2: "Bhaalu" },
  { at: "2026-08-21T19:10:00+05:00", team1: "Bheriye", team2: "Zarafay" },
  { at: "2026-08-21T19:50:00+05:00", team1: "Bhaalu", team2: "Gorillay" },
  { at: "2026-08-21T20:30:00+05:00", team1: "Cheetay", team2: "Bheriye" },
  { at: "2026-08-21T21:10:00+05:00", team1: "Gorillay", team2: "Zarafay" },
  { at: "2026-08-21T21:50:00+05:00", team1: "Bhaalu", team2: "Bheriye" },
  { at: "2026-08-21T22:30:00+05:00", team1: "Gorillay", team2: "Cheetay" },
  { at: "2026-08-21T23:10:00+05:00", team1: "Bhaalu", team2: "Zarafay" },
  { at: "2026-08-21T23:50:00+05:00", team1: "Zarafay", team2: "Cheetay" },
  { at: "2026-08-22T00:30:00+05:00", team1: "Gorillay", team2: "Bheriye" }
];

async function wipeCompetition() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Delivery",
      "Commentary",
      "PlayingXI",
      "MatchOfficial",
      "Innings",
      "AuditLog",
      "Match",
      "Fixture",
      "PlayerStatistics",
      "TeamStatistics",
      "PointsTable",
      "TeamPlayer",
      "Player",
      "Team",
      "Group",
      "Venue",
      "TournamentRule",
      "Tournament"
    RESTART IDENTITY CASCADE
  `);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  console.log("Wiping tournaments, teams, players, fixtures, matches, stats…");
  await wipeCompetition();

  const tournament = await prisma.tournament.create({
    data: {
      name: "Wolfpack Tape Ball League",
      season: "2026",
      featured: true,
      status: "ACTIVE",
      startDate: new Date("2026-08-21T00:00:00+05:00"),
      endDate: new Date("2026-08-22T02:00:00+05:00"),
      rules: {
        create: {
          oversPerInnings: 6,
          groupOversPerInnings: 6,
          knockoutOversPerInnings: 8,
          finalOversPerInnings: 10,
          ballsPerOver: 6,
          playersPerSide: 8,
          maxOversPerBowler: 2,
          retirementScore: 30,
          tieHandling: "SUPER_OVER"
        }
      }
    }
  });

  const venue = await prisma.venue.create({
    data: { tournamentId: tournament.id, name: "Wolfpack Ground", city: "Lahore" }
  });

  const group = await prisma.group.create({
    data: { tournamentId: tournament.id, name: "League" }
  });

  const teamIds = new Map<string, string>();
  for (const squad of TEAMS) {
    const team = await prisma.team.create({
      data: {
        tournamentId: tournament.id,
        groupId: group.id,
        name: squad.name,
        shortName: squad.name
      }
    });
    teamIds.set(squad.name, team.id);
    for (let i = 0; i < squad.players.length; i++) {
      const player = await prisma.player.create({ data: { name: squad.players[i] } });
      await prisma.teamPlayer.create({
        data: {
          teamId: team.id,
          playerId: player.id,
          jerseyNumber: i + 1,
          isCaptain: squad.players[i] === squad.captain
        }
      });
    }
  }

  for (let i = 0; i < FIXTURES.length; i++) {
    const f = FIXTURES[i];
    const team1Id = teamIds.get(f.team1);
    const team2Id = teamIds.get(f.team2);
    if (!team1Id || !team2Id) throw new Error(`Missing team for ${f.team1} vs ${f.team2}`);
    const scheduledAt = new Date(f.at);
    const fixture = await prisma.fixture.create({
      data: {
        tournamentId: tournament.id,
        groupId: group.id,
        team1Id,
        team2Id,
        venueId: venue.id,
        scheduledAt,
        stage: "GROUP",
        round: "League"
      }
    });
    await prisma.match.create({
      data: {
        no: i + 1,
        fixtureId: fixture.id,
        tournamentId: tournament.id,
        team1Id,
        team2Id,
        venueId: venue.id,
        scheduledAt,
        status: "SCHEDULED",
        oversPerInnings: 6,
        maxOversPerBowler: 2
      }
    });
  }

  await prisma.$executeRawUnsafe(`
    SELECT setval(
      pg_get_serial_sequence('"Match"', 'no'),
      (SELECT COALESCE(MAX(no), 1) FROM "Match")
    )
  `);

  const [teams, players, fixtures, matches, users] = await Promise.all([
    prisma.team.count(),
    prisma.player.count(),
    prisma.fixture.count(),
    prisma.match.count(),
    prisma.user.count()
  ]);
  console.log(
    JSON.stringify(
      {
        tournament: tournament.name,
        teams,
        players,
        fixtures,
        matches,
        usersKept: users
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
