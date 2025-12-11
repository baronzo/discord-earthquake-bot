import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } from "discord.js";
import cron from "node-cron";
import { fetchEarthquakes } from "./earthquakeFetcher.js";
import "dotenv/config";
import express from "express";

// --- ส่วน Keep-Alive Web Server ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Earthquake Bot is active!');
});

app.listen(port, () => {
  console.log(`🌐 Dummy server is running on port ${port}`);
});
// ----------------------------------

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
  new SlashCommandBuilder()
    .setName("earthquake")
    .setDescription("Check for recent earthquake alerts immediately")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("⏳ Registering commands...");
    await rest.put(Routes.applicationCommands(process.env.APPLICATION_ID), { body: commands });
    console.log("✅ Commands registered.");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
})();

client.once("ready", async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);

  // Run every 1 minute
  cron.schedule("* * * * *", async () => {
    console.log("Running scheduled earthquake check...");
    await checkAndSendEarthquakes();
  });
});

async function checkAndSendEarthquakes(interaction = null) {
  const alerts = await fetchEarthquakes();

  if (alerts.length === 0) {
    if (interaction) await interaction.editReply("❌ No new earthquake alerts found.");
    return;
  }

  let channel = client.channels.cache.get(process.env.NEWS_CHANNEL_ID);
  if (!channel) {
    try {
      channel = await client.channels.fetch(process.env.NEWS_CHANNEL_ID);
    } catch (error) {
      console.error("หาห้อง Discord ไม่เจอ:", error);
      return;
    }
  }

  for (const alert of alerts) {
    console.log(`🚨 Alert Triggered! Found ${alerts.length} new earthquakes.`);
    const embed = createEarthquakeEmbed(alert);
    if (channel) {
      await channel.send({ embeds: [embed] });
    }
  }

  if (interaction) await interaction.editReply(`Found ${alerts.length} new alerts.`);
}

function createEarthquakeEmbed(alert) {
  const color = alert.mag >= 5.0 ? 0xFF0000 : 0xFFA500; // Red for >5, Orange for others
  const emoji = alert.mag >= 5.0 ? "🚨" : "⚠️";

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${emoji} Earthquake Alert: M ${alert.mag.toFixed(1)}`)
    .setURL(alert.url)
    .setDescription(`**Location:** ${alert.place}\n**Time:** ${alert.time.toLocaleString("th-TH")}\n[View on Map](${alert.url})`)
    .setTimestamp(alert.time)
    .setFooter({ text: "USGS Earthquake Data" });
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "earthquake") {
    await interaction.deferReply();
    // Re-checking manually might not show anything if they were already alerted (due to Set deduplication).
    // But it triggers the fetch function which is useful.
    // Note: Since 'sentAlerts' is in memory, if the user asks immediately after a cron run, it won't show duplicate alerts.
    // This is generally desired behavior.
    await checkAndSendEarthquakes(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);