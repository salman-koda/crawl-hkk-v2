const axios = require("axios");
const fs = require("fs");
const https = require("https");
const cheerio = require("cheerio");
const { Storage } = require("@google-cloud/storage");

const httpClient = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false,
    keepAlive: true,
  }),
});

// Year, Total Pages
const arr = [
  [2023, 139],
  [2022, 134],
];

const errorPdf = {};
const baseURL = "https://putusan3.mahkamahagung.go.id";
const folderName = "pn-jakbar-perdata";
const pathLog = "./log.txt";

// Initialize Google Cloud Storage
const storage = new Storage({
  keyFilename: "./google-cloud-storage-creds-prod.json",
});
const bucketName = "hukumku-prod-bucket";
const bucket = storage.bucket(bucketName);

async function main() {
  for (let index = 0; index < arr.length; index++) {
    const year = arr[index][0];
    const totalPage = arr[index][1];
    logToFile(year, `YEAR`);
    for (let page = 1; page <= totalPage; page++) {
      logToFile(page, `PAGE`);
      console.log(`=+=+=+=+=page ${page}=+=+=+=+=`);
      const url = `${baseURL}/direktori/index/pengadilan/pn-jakarta-barat/kategori/perdata-1/tahunjenis/putus/tahun/${year}/page/${page}.html`;
      let totalDoc = 0;
      try {
        const listResp = await httpClient.get(url);
        const listHtmlContent = listResp.data;

        // Load html content
        const $listHtmlContent = cheerio.load(listHtmlContent);

        // Grab id tabs-1 contents (putusan ma)
        const putusanListContent = $listHtmlContent("#tabs-1").html();
        const $putusanListContent = cheerio.load(putusanListContent);

        const detailUrlRegex =
          /^https:\/\/putusan3\.mahkamahagung\.go\.id\/direktori\/putusan\/.*\.html$/;

        const detailUrls = [];
        // Get all detail urls on this page
        $putusanListContent("a").each((_, element) => {
          const href = $putusanListContent(element).attr("href");
          if (href && detailUrlRegex.test(href)) {
            detailUrls.push(href);
          }
        });

        // Loops every detail page
        for (let i = 0; i < detailUrls.length; i++) {
          const detailResp = await httpClient.get(detailUrls[i]);
          const detailHtmlContent = detailResp.data;

          const $detailHtmlContent = cheerio.load(detailHtmlContent);

          const pdfUrlRegex =
            /^https:\/\/putusan3\.mahkamahagung\.go\.id\/direktori\/download_file\/[^\/]+\/pdf\/[^\/]+$/;

          let fileName = null;
          // Get title
          const name = $detailHtmlContent("h1").first().text();
          if (name) {
            fileName = `${snakeCase(name)}.pdf`;
          }

          // Get all pdf urls on this page
          $detailHtmlContent("a").each(async (_, element) => {
            const href = $detailHtmlContent(element).attr("href");
            if (href && pdfUrlRegex.test(href)) {
              console.log("Found PDF URL:", href);
              const parts = href.split("/");
              const title = parts[parts.length - 1];

              try {
                await uploadFileFromURL(href, fileName);
                totalDoc++;
              } catch (err) {
                errorPdf[title] = { page, error: err.message };
                if (err.message !== "type not allowed") {
                  logToFile(page, `${fileName} - ${href} - ${err.message}`);
                }
              }
            }
          });
        }
        if (totalDoc === 0) {
          logToFile(page, "No Document Found");
        }
      } catch (err) {
        logToFile(page, err);
        console.error("Error:", err);
      }
    }
  }
}

const snakeCase = (string) => string.toLowerCase().replace(/\W+/g, "-");

function logToFile(page, logMessage) {
  const timestamp = new Date().toISOString();
  const message = `${timestamp} - ${page} - ${logMessage}\n`;

  fs.appendFile(pathLog, message, (err) => {
    if (err) {
      console.error("Error writing to file", err);
    } else {
      console.log("Log added to file");
    }
  });
}

async function uploadFileFromURL(url, fileName) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await axios({
        url,
        method: "GET",
        responseType: "stream",
      });

      const file = bucket.file(`${folderName}/${fileName}`);

      response.data
        .pipe(file.createWriteStream())
        .on("error", (err) => {
          reject(new Error(err));
          console.log("Error uploading file:", err);
        })
        .on("finish", () => {
          resolve(`File uploaded to '${fileName}' in bucket '${bucketName}'`);
          console.log(
            `File uploaded to '${fileName}' in bucket '${bucketName}'`
          );
        });
    } catch (error) {
      console.error("Error fetching file from URL:", error);
    }
  });
}

main();
