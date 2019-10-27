import React from 'react'
import { BibleEngineClient } from '@bible-engine/client'
import {
  IBibleReferenceRangeQuery,
  BibleEngine,
  BibleVersionEntity,
} from '@bible-engine/core'
import * as FileSystem from 'expo-file-system'
import { Asset } from 'expo-asset'
import { SQLite } from 'expo-sqlite'
import NetInfo from '@react-native-community/netinfo'
import { REMOTE_BIBLE_ENGINE_URL } from 'react-native-dotenv'

import Fonts from './Fonts'
import * as store from 'react-native-simple-store'
import { AsyncStorageKey } from './Constants'
import { ConnectionOptions } from 'typeorm'
const bibleDatabaseModule = require('../assets/bibles.db')

const BIBLE_ENGINE_OPTIONS: ConnectionOptions = {
  database: 'bibles.db',
  type: 'expo',
  synchronize: false,
}

const GlobalContext = React.createContext({})

export class GlobalContextProvider extends React.Component<{}, {}> {
  bibleEngineClient: BibleEngineClient
  state = {
    chapterContent: [],
    versionChapterNum: 1,
    bibleVersions: [],
    books: [],
    bookOsisId: '',
    versionUid: '',
    fontsAreReady: false,
    loading: true,
    forceRemote: true,
    isConnected: true,
  }
  constructor(props: any) {
    super(props)
    NetInfo.addEventListener(this.onNetworkChange)
    this.bibleEngineClient = new BibleEngineClient({
      apiBaseUrl: REMOTE_BIBLE_ENGINE_URL,
    })
    this.loadFonts()
  }

  async componentDidMount() {
    await this.getSavedState()
  }

  onNetworkChange = ({ isConnected }) => {
    this.setState({ ...this.state, isConnected })
  }

  async loadFonts() {
    await Fonts.load()
    this.setState({ ...this.state, fontsAreReady: true })
  }

  async getSavedState() {
    const [cachedChapterNum, cachedBookName, cachedVersion] = await store.get([
      AsyncStorageKey.CACHED_CHAPTER_NUM,
      AsyncStorageKey.CACHED_OSIS_BOOK_NAME,
      AsyncStorageKey.CACHED_VERSION_UID,
    ])
    const DEFAULT_BOOK = 'Gen'
    const DEFAULT_CHAPTER = 1
    const DEFAULT_VERSION = 'ESV'
    const bookOsisId = cachedBookName || DEFAULT_BOOK
    const versionChapterNum = cachedChapterNum || DEFAULT_CHAPTER
    const versionUid = cachedVersion || DEFAULT_VERSION

    this.setLocalDatabase()
    this.setVersions()
    this.setBooks(versionUid)

    await this.updateCurrentBibleReference({
      bookOsisId,
      versionChapterNum,
      versionUid,
    })
  }

  async setVersions() {
    const bibleVersions = await this.bibleEngineClient.getBothOfflineAndOnlineVersions()
    this.setState({ ...this.state, bibleVersions })
  }

  async setBooks(versionUid: string) {
    const books = await this.bibleEngineClient.getBooksForVersion(
      versionUid,
      this.state.forceRemote
    )
    this.setState({ ...this.state, books })
  }

  async setLocalDatabase() {
    try {
      const PATH_TO_DOWNLOAD_TO = `${FileSystem.documentDirectory}SQLite/bibles.db`
      let bibleEngine = new BibleEngine(BIBLE_ENGINE_OPTIONS)
      if (!(await this.testQueryWorks(bibleEngine))) {
        await this.closeDatabaseConnection(bibleEngine)
        const asset = Asset.fromModule(bibleDatabaseModule)
        await FileSystem.downloadAsync(asset.uri, PATH_TO_DOWNLOAD_TO)
        bibleEngine = new BibleEngine(BIBLE_ENGINE_OPTIONS)
      }
      this.bibleEngineClient.localBibleEngine = bibleEngine
    } catch (e) {}
  }

  async closeDatabaseConnection(bibleEngine: BibleEngine) {
    const db = await bibleEngine.pDB
    await db.connection.close()
    const expoDb: any = await SQLite.openDatabase('bibles.db')
    expoDb._db.close()
  }

  async testQueryWorks(bibleEngine: BibleEngine): Promise<boolean> {
    try {
      const result = await bibleEngine.getDictionaryEntries(
        'H0001',
        '@BdbMedDef'
      )
      return !!result.length
    } catch (e) {
      console.log('localDatabaseIsValid catch', e)
      return false
    }
  }

  updateCurrentBibleReference = async (range: IBibleReferenceRangeQuery) => {
    this.setState({ ...this.state, ...range, loading: true })
    const chapter = await this.bibleEngineClient.getFullDataForReferenceRange(
      range,
      this.state.forceRemote,
      true
    )
    const chapterContent = chapter.content.contents
    this.setState(
      {
        ...this.state,
        ...range,
        chapterContent,
      },
      () => {
        this.setState({ ...this.state, loading: false })
      }
    )
  }

  changeCurrentBibleVersion = async (version: BibleVersionEntity) => {
    const { bookOsisId, versionChapterNum } = this.state
    const newReference = {
      bookOsisId,
      versionChapterNum,
      versionUid: version.uid,
    }
    const forceRemote = version.dataLocation !== 'db'
    this.setState({ ...this.state, forceRemote })
    this.updateCurrentBibleReference(newReference)
    this.setBooks(version.uid)
  }

  render() {
    return (
      <GlobalContext.Provider
        value={{
          ...this.state,
          bibleEngine: this.bibleEngineClient,
          updateCurrentBibleReference: this.updateCurrentBibleReference,
          changeCurrentBibleVersion: this.changeCurrentBibleVersion,
        }}
      >
        {this.props.children}
      </GlobalContext.Provider>
    )
  }
}

export const withGlobalContext = (ChildComponent: any) => (props: any) => (
  <GlobalContext.Consumer>
    {context => <ChildComponent {...props} global={context} />}
  </GlobalContext.Consumer>
)