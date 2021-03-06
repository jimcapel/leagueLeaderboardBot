const discord = require("discord.js");
const Sequelize = require("sequelize");

//imports
const rankCalculator = require("./args/rankCalculator");
const regionChange = require("./args/regionChange");
const embeds = require("./embeds/embeds");
const RiotAPICalls = require("./riotApiCalls/riotApiCalls");

const client = new discord.Client();

//define sqllite model for testing
/*
const sequelize = new Sequelize("database", "username", "password", {
    host: 'localhost',
	dialect: 'sqlite',
	logging: false,
	// SQLite only
	storage: 'database.sqlite',
});
*/

const sequelize = new Sequelize(process.env.CLEARDB_DATABASE_URL, {
  logging: false,
});



const Tags = sequelize.define("tags", {
  guildId: Sequelize.STRING,
  username: {
    type: Sequelize.STRING,
  },
  summonerName: {
    type: Sequelize.STRING,
  },
  server: Sequelize.STRING,
  rankInt: Sequelize.INTEGER,
  tier: Sequelize.STRING,
  rank: Sequelize.STRING,
  leaguePoints: Sequelize.STRING,
  encryptedSummonerId: Sequelize.STRING,
  wins: Sequelize.INTEGER,
  losses: Sequelize.INTEGER,
});

client.once("ready", () => {
  Tags.sync(); //{ force: true }
  console.log("leagueBot online");
});

client.on("guildCreate", (guild) => {
  console.log(`joined ${guild}`);
});

client.on("guildDelete", async (guild) => {
  await Tags.destroy({ where: { guildId: guild.id } });

  console.log(`left ${guild}`);
});

client.on("message", async (message) => {
  const prefix = "!";

  //check if message starts with ! or if sent by bot
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  let args = message.content.slice(prefix.length).trim().split(" ");

  args = message.content.slice(prefix.length).trim().split(" ");
  args = message.content.slice(prefix.length).trim().split(/ +/);

  const command = args.shift().toLowerCase();

  if (args.length) {
    args[0] = regionChange.regionChange(args[0]);
  }

  //deal with command
  if (command == "rank") {
    if (!args.length) {
      const tag = await Tags.findOne({
        where: {
          username: `${message.author.username}`,
          guildId: message.guild.id,
        },
      });
      if (tag) {
        let summonerInfo = await RiotAPICalls.getSummonerById(
          tag.encryptedSummonerId,
          tag.server
        );

        let soloQueue;

        if (summonerInfo[0].queueType == "RANKED_SOLO_5x5") {
          soloQueue = summonerInfo[0];
        } else {
          soloQueue = summonerInfo[1];
        }

        let rankInt = rankCalculator.rankCalculator(
          soloQueue.tier,
          soloQueue.rank,
          soloQueue.leaguePoints
        );

        await Tags.update(
          {
            tier: soloQueue.tier,
            rankInt: rankInt,
            leaguePoints: soloQueue.leaguePoints,
            rank: soloQueue.rank,
          },
          {
            where: {
              username: message.author.username,
              guildId: message.guild.id,
            },
          }
        );

        return message.reply(
          `${tag.summonerName}: ${soloQueue.tier} ${soloQueue.rank} ${soloQueue.leaguePoints} LP`
        );
      } else {
        return message.reply(
          `${message.author.tag} you have not bound an account! use \"!add [region] [summonername]\" to bind a summonername to your account`
        );
      }
    } else if (args.length == 2) {
      let summonerInfo = await RiotAPICalls.returnRank(args[1], args[0]);

      if (summonerInfo == -1)
        return message.reply(`${args[1]} in region ${args[0]} not found!`);

      let soloQueue;

      if (summonerInfo[0].queueType == "RANKED_SOLO_5x5") {
        soloQueue = summonerInfo[0];
      } else {
        soloQueue = summonerInfo[1];
      }

      if (soloQueue)
        return message.reply(
          `${soloQueue.summonerName} is currently: ${soloQueue.tier} ${soloQueue.rank} ${soloQueue.leaguePoints} LP`
        );

      return message.reply(`${args[1]} is unranked!`);
    }
  }

  if (command == "add") {
    if (args.length != 2)
      return message.reply(
        `use \"!add [region] [summonername]\" to bind your account!`
      );

    let tag = await Tags.findOne({
      where: { summonerName: `${args[1]}`, guildId: message.guild.id },
    });

    if (tag)
      return message.reply(
        `summoner ${args[1]} is already bound! please choose another summoner`
      );

    let row = await Tags.findOne({
      where: { username: message.author.username, guildId: message.guild.id },
    });

    
    if (row)
      return message.reply(
        'a summonername is already bound, use "!remove" to delete current bind'
      );
    

    let [
      summonerInfo,
      encryptedSummonerId,
    ] = await RiotAPICalls.getSummonerByName(args[1], args[0]);

    if (summonerInfo == -1)
      return message.reply(`${args[1]} in region ${args[0]} not found!`);

    let soloQueue;

    if (summonerInfo[0].queueType == "RANKED_SOLO_5x5") {
      soloQueue = summonerInfo[0];
    } else {
      soloQueue = summonerInfo[1];
    }

    if (soloQueue) {
      let rankInt = rankCalculator.rankCalculator(
        soloQueue.tier,
        soloQueue.rank,
        soloQueue.leaguePoints
      );
      try {
        const tag = await Tags.create({
          guildId: message.guild.id,
          username: message.author.username,
          summonerName: soloQueue.summonerName,
          server: args[0],
          rankInt: rankInt,
          tier: soloQueue.tier,
          rank: soloQueue.rank,
          leaguePoints: soloQueue.leaguePoints,
          encryptedSummonerId: encryptedSummonerId,
          wins: soloQueue.wins,
          losses: soloQueue.losses,
        });
        return message.reply(`${tag.summonerName} added.`);
      } catch (e) {
        if (e.name === "SequelizeUniqueConstraintError") {
          return message.reply("That tag already exists.");
        }
        return message.reply("Something went wrong with adding a tag.");
      }
    }
  }

  if (command == "ranks") {
    let leaderboard = [];

    const tagList = await Tags.findAll({
      where: { guildId: message.guild.id },
    });

    if (!tagList.length)
      return message.reply(
        `no summoners are currently stored! use \"!add [region] [summonername]\" to add a summoner`
      );

    for (let i = 0; i < tagList.length; i++) {
      let summonerInfo = await RiotAPICalls.getSummonerById(
        tagList[i].encryptedSummonerId,
        tagList[i].server
      );

      let soloQueue;

      if (summonerInfo[0].queueType == "RANKED_SOLO_5x5") {
        soloQueue = summonerInfo[0];
      } else {
        soloQueue = summonerInfo[1];
      }

      let rankInt = rankCalculator.rankCalculator(
        soloQueue.tier,
        soloQueue.rank,
        soloQueue.leaguePoints
      );
      leaderboard.push([
        soloQueue.summonerName,
        rankInt,
        soloQueue.tier,
        soloQueue.rank,
        soloQueue.leaguePoints,
      ]);
      await Tags.update(
        {
          tier: soloQueue.tier,
          rankInt: rankInt,
          leaguePoints: soloQueue.leaguePoints,
          rank: soloQueue.rank,
        },
        {
          where: {
            summonerName: tagList[i].summonerName,
            guildId: message.guild.id,
          },
        }
      );
    }

    let sorted = leaderboard.sort(function (a, b) {
      return b[1] - a[1];
    });

    return message.channel.send(embeds.embedRanks(message.guild.name, sorted));
  }

  if (command == "remove") {
    const row = await Tags.destroy({
      where: { username: message.author.username, guildId: message.guild.id },
    });

    if (!row) return message.reply("nothing to remove!");

    return message.reply(`remove succseful!`);
  }

});

client.login(process.env.BOT_KEY); //process.env.BOT_KEY
