import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

const names = {
  kings: [
    ["Ahmed Shah", "BATSMAN", "Right-hand"],
    ["Bilal Qureshi", "ALL_ROUNDER", "Right-hand"],
    ["Farhan Malik", "BATSMAN", "Left-hand"],
    ["Hamza Tariq", "WK", "Right-hand"],
    ["Imran Raza", "BOWLER", "Right-hand"],
    ["Junaid Akram", "BOWLER", "Left-hand"],
    ["Kashif Noor", "BATSMAN", "Right-hand"],
    ["Noman Iqbal", "ALL_ROUNDER", "Right-hand"],
    ["Owais Khan", "BOWLER", "Right-hand"],
    ["Samiullah", "BATSMAN", "Left-hand"],
    ["Usman Ghani", "BOWLER", "Right-hand"],
    ["Zain Abbas", "ALL_ROUNDER", "Right-hand"]
  ],
  lions: [
    ["Ali Haider", "BATSMAN", "Right-hand"],
    ["Babar Nadeem", "BATSMAN", "Right-hand"],
    ["Danish Rauf", "ALL_ROUNDER", "Left-hand"],
    ["Ehsanullah", "WK", "Right-hand"],
    ["Fawad Cheema", "BOWLER", "Right-hand"],
    ["Gulzar Ahmed", "BOWLER", "Left-hand"],
    ["Hassan Raza", "BATSMAN", "Right-hand"],
    ["Irfan Shah", "ALL_ROUNDER", "Right-hand"],
    ["Khurram Butt", "BOWLER", "Right-hand"],
    ["Liaqat Ali", "BATSMAN", "Left-hand"],
    ["Mohsin Ali", "BOWLER", "Right-hand"],
    ["Taimoor Sajjad", "ALL_ROUNDER", "Right-hand"]
  ],
  invincibles: [
    ["Ahsan Zafar", "BATSMAN", "Right-hand"],
    ["Basit Ali", "ALL_ROUNDER", "Right-hand"],
    ["Camran Shahzad", "BATSMAN", "Left-hand"],
    ["Dilawar Khan", "WK", "Right-hand"],
    ["Fahad Mustafa", "BOWLER", "Right-hand"],
    ["Haroon Rasheed", "BOWLER", "Right-hand"],
    ["Ihtisham", "BATSMAN", "Right-hand"],
    ["Jahangir Khan", "ALL_ROUNDER", "Left-hand"],
    ["Kamran Akmal Jr", "WK", "Right-hand"],
    ["Luqman Shah", "BOWLER", "Left-hand"],
    ["Mudassar", "BATSMAN", "Right-hand"],
    ["Waqas Riaz", "BOWLER", "Right-hand"]
  ],
  panthers: [
    ["Adnan Afridi", "BATSMAN", "Right-hand"],
    ["Shahid Khan", "ALL_ROUNDER", "Right-hand"],
    ["Yasir Shinwari", "BATSMAN", "Left-hand"],
    ["Rizwan Gul", "WK", "Right-hand"],
    ["Fawad Alam Jr", "BATSMAN", "Left-hand"],
    ["Naseemullah", "BOWLER", "Right-hand"],
    ["Ijaz Jan", "BOWLER", "Left-hand"],
    ["Sohail Khan", "ALL_ROUNDER", "Right-hand"],
    ["Umar Daraz", "BATSMAN", "Right-hand"],
    ["Wahab Jr", "BOWLER", "Left-hand"],
    ["Zubair Shah", "BOWLER", "Right-hand"],
    ["Haseebullah", "WK", "Right-hand"]
  ]
};

async function upsertUser(oldEmail: string, email: string, name: string, role: "ADMIN" | "UMPIRE", passwordHash: string) {
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { email: oldEmail }] }
  });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { email, name, role, passwordHash }
    });
  }
  return prisma.user.create({ data: { email, name, role, passwordHash } });
}

async function makeTeam(
  tournamentId: string,
  groupId: string,
  name: string,
  shortName: string,
  city: string,
  roster: string[][]
) {
  const team = await prisma.team.create({
    data: { tournamentId, groupId, name, shortName, city }
  });
  for (let i = 0; i < roster.length; i++) {
    const [pname, role, battingStyle] = roster[i];
    const player = await prisma.player.create({
      data: { name: pname, role, battingStyle, bowlingStyle: role === "BOWLER" ? "Right-arm fast" : undefined }
    });
    await prisma.teamPlayer.create({
      data: {
        teamId: team.id,
        playerId: player.id,
        jerseyNumber: i + 1,
        isCaptain: i === 0,
        isWicketKeeper: role === "WK"
      }
    });
  }
  return team;
}

async function main() {
  console.log("Seeding Wolfpack Tape Ball League (no matches)…");
  const passwordHash = await bcrypt.hash("password123", 10);
  await upsertUser("admin@lms.local", "admin@wolfpackcricket.com", "Ayesha Admin", "ADMIN", passwordHash);
  await upsertUser("umpire@lms.local", "umpire@wolfpackcricket.com", "Umar Umpire", "UMPIRE", passwordHash);

  await prisma.delivery.deleteMany();
  await prisma.commentary.deleteMany();
  await prisma.innings.deleteMany();
  await prisma.playingXI.deleteMany();
  await prisma.matchOfficial.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.match.deleteMany();
  await prisma.fixture.deleteMany();

  let tournament = await prisma.tournament.findFirst({ where: { name: "Wolfpack Tape Ball League" } });
  if (!tournament) {
    tournament = await prisma.tournament.create({
      data: {
        name: "Wolfpack Tape Ball League",
        season: "2026",
        featured: true,
        status: "ACTIVE",
        startDate: new Date("2026-08-01"),
        endDate: new Date("2026-08-30"),
        rules: {
          create: {
            oversPerInnings: 6,
            groupOversPerInnings: 6,
            knockoutOversPerInnings: 8,
            finalOversPerInnings: 10,
            maxOversPerBowler: 2,
            tieHandling: "SUPER_OVER"
          }
        }
      }
    });
    const venue = await prisma.venue.create({
      data: { tournamentId: tournament.id, name: "Gulberg Tape Ball Arena", city: "Lahore" }
    });
    await prisma.venue.create({
      data: { tournamentId: tournament.id, name: "Sea View Ground", city: "Karachi" }
    });
    void venue;
    const groupA = await prisma.group.create({ data: { tournamentId: tournament.id, name: "Group A" } });
    const groupB = await prisma.group.create({ data: { tournamentId: tournament.id, name: "Group B" } });
    await makeTeam(tournament.id, groupA.id, "Karachi Kings", "KK", "Karachi", names.kings);
    await makeTeam(tournament.id, groupA.id, "Lahore Lions", "LL", "Lahore", names.lions);
    await makeTeam(tournament.id, groupB.id, "Islamabad Invincibles", "II", "Islamabad", names.invincibles);
    await makeTeam(tournament.id, groupB.id, "Peshawar Panthers", "PP", "Peshawar", names.panthers);
  }

  console.log("Seed complete. No fixtures or matches were created.");
  console.log("Admin   admin@wolfpackcricket.com / password123");
  console.log("Umpire  umpire@wolfpackcricket.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
