import mongoose from 'mongoose'
import env from './utils/env.util'
import request from './utils/request.util'
import sleep from './utils/sleep.util'
import Item from './models/item.model'
import sendMail from './utils/sendMail'

const MAX_RELEASE_PER_PAGE = 500
const MAX_VERSION_PER_PAGE = 100

// eslint-disable-next-line no-console
console.log('Getting releases data')

/**
 * Get number of releases for a given artist
 * @type {import('axios').AxiosResponse<ApiDiscogsArtistReleaseType>}
 */
const releasesTotalResult = await request({
    url: `artists/${env.DISCOGS_ARTIST_ID}/releases`,
    params: {
        per_page: 1,
    },
})

/**
 * Get all releases for a given artist
 * @type {import('axios').AxiosResponse<ApiDiscogsArtistReleaseType>[]}
 */
const releasesResults = await Promise.all(
    new Array(Math.ceil(releasesTotalResult.data.pagination.items / MAX_RELEASE_PER_PAGE))
        .fill({})
        .map((_, i) => request({
            url: `artists/${env.DISCOGS_ARTIST_ID}/releases`,
            params: {
                per_page: MAX_RELEASE_PER_PAGE,
                page: i + 1,
            },
        })),
)

/** Array of releases: data are transformed and cleaned */
const releases = releasesResults
    .map(releasesResult => releasesResult.data.releases)
    .flat()
    .map(release => ({
        id: release.id,
        type: release.type,
        artist: release.artist,
        label: release.label,
        title: release.title,
        format: release.format,
        date: release.year !== 0 ? release.year?.toString() : undefined,
        thumb: release.thumb,
        role: release.role?.match(/[A-Z][a-z]+/g).join(' '),
    }))

/** Release of type `release` found */
const releasesFound = releases.filter(release => release.type === 'release')

/** Release of type `master` found */
const mastersFound = releases.filter(release => release.type === 'master')

// eslint-disable-next-line no-console
console.log('Getting masters data')

// As releases on Discogs API can also be of type 'master' (this type of release is a folder of releases), we need to get all releases of a master
// eslint-disable-next-line no-restricted-syntax
for (const [index, master] of mastersFound.entries()) {
    // eslint-disable-next-line no-console
    console.log(`Master ${index + 1}/${mastersFound.length}`)

    /**
     * Get number of versions for a given master
     * @type {import('axios').AxiosResponse<ApiDiscogsMasterType>}
     */
    // eslint-disable-next-line no-await-in-loop
    const mastersTotalResult = await request({
        url: `masters/${master.id}/versions`,
        params: {
            per_page: 1,
        },
    })

    /**
     * Get all versions for a given master
     * @type {import('axios').AxiosResponse<ApiDiscogsMasterType>[]}
     */
    // eslint-disable-next-line no-await-in-loop
    const mastersResults = await Promise.all(
        new Array(Math.ceil(mastersTotalResult.data.pagination.items / MAX_VERSION_PER_PAGE))
            .fill({})
            .map((_, i) => request({
                url: `masters/${master.id}/versions`,
                params: {
                    per_page: MAX_VERSION_PER_PAGE,
                    page: i + 1,
                },
            })),
    )

    // Add releases from master to `releasesFound`
    // eslint-disable-next-line no-restricted-syntax
    for (const version of mastersResults.map(mastersResult => mastersResult.data.versions).flat())
        releasesFound.push({
            id: version.id,
            type: 'release',
            artist: master.artist,
            label: version.label,
            title: version.title,
            format: version.format,
            date: version.released !== '0' ? version.released : undefined,
            thumb: version.thumb,
            role: master.role?.match(/[A-Z][a-z]+/g).join(' '),
        })

    // Sleep some times to prevent being blocked
    // eslint-disable-next-line no-await-in-loop
    await sleep(2500)
}

// Connect to DB
await mongoose.connect(env.DB_URI)

/**
 * Items found from DB
 * @type {import('./models/item.model').ItemSchema[]}
 */
const itemsDb = await Item.find({})

/** List of item to send by mail */
const releasesToSend = releasesFound.filter(itemFound => !itemsDb.map(itemDb => itemDb.id).includes(itemFound.id))

// If new items found, send mail
if (releasesToSend?.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Sending mail')
    await sendMail(releasesToSend)
} else {
    // eslint-disable-next-line no-console
    console.log('No data to send')
}

// Upsert data found in DB
await Promise.all(releasesFound.map(item => Item.findOneAndUpdate(
    { id: item.id },
    { id: item.id, title: `${item.artist} - ${item.title}` },
    { upsert: true },
)))

// eslint-disable-next-line no-console
console.log('Done')

process.exit(0)