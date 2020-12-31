'use strict'

/*
 * This module provides formatters and parsers for the Aurora Serverless
 * Data API.
 *
 * @author Roy Paterson <roy@roypaterson.com>
 * @author Jeremy Daly <jeremy@jeremydaly.com>
 * @version 1.2.0
 * @license MIT
 */

// Supported value types in the Data API
const supportedTypes = [
  'arrayValue',
  'blobValue',
  'booleanValue',
  'doubleValue',
  'isNull',
  'longValue',
  'stringValue',
  'structValue'
]

/********************************************************************/
/**  PRIVATE METHODS                                               **/
/********************************************************************/

// Simple error function
const error = (...err) => { throw Error(...err) }

// Parse the parameters from provided arguments
const parseParams = args =>
  Array.isArray(args[0].parameters) ? args[0].parameters
  : typeof args[0].parameters === 'object' ? [args[0].parameters]
  : Array.isArray(args[1]) ? args[1]
  : typeof args[1] === 'object' ? [args[1]]
  : args[0].parameters ? error('\'parameters\' must be an object or array')
  : args[1] ? error('Parameters must be an object or array')
  : []

// Normize parameters so that they are all in standard format
const normalizeParams = params => params.reduce((acc, p) =>
  Array.isArray(p) ? acc.concat([normalizeParams(p)])
  : (
    (Object.keys(p).length === 2 && p.name && p.value !== 'undefined') ||
    (Object.keys(p).length === 3 && p.name && p.value !== 'undefined' && p.cast)
  ) ? acc.concat(p)
    : acc.concat(splitParams(p))
, []) // end reduce

// Prepare parameters
const processParams = (engine,params,formatOptions,row=0) => {
  return {
    processedParams: params.reduce((acc,p) => {
      if (Array.isArray(p)) {
        const result = processParams(engine,p,formatOptions,row)
        if (row === 0) { row++ }
        return acc.concat([result.processedParams])
      } else {
        acc.push(formatParam(p.name,p.value,formatOptions))
        return acc
      }
    },[])
  }
}

// Converts parameter to the name/value format
const formatParam = (n,v,formatOptions) => formatType(n,v,getType(v),getTypeHint(v),formatOptions)

// Converts object params into name/value format
const splitParams = p => Object.keys(p).reduce((arr,x) =>
  arr.concat({ name: x, value: p[x] }),[])

// Gets the value type and returns the correct value field name
// TODO: Support more types as the are released
const getType = val =>
  typeof val === 'string' ? 'stringValue'
  : typeof val === 'boolean' ? 'booleanValue'
  : typeof val === 'number' && parseInt(val) === val ? 'longValue'
  : typeof val === 'number' && parseFloat(val) === val ? 'doubleValue'
  : val === null ? 'isNull'
  : isDate(val) ? 'stringValue'
  : Buffer.isBuffer(val) ? 'blobValue'
  // : Array.isArray(val) ? 'arrayValue' This doesn't work yet
  // TODO: there is a 'structValue' now for postgres
  : typeof val === 'object'
    && Object.keys(val).length === 1
    && supportedTypes.includes(Object.keys(val)[0]) ? null
  : undefined

// Hint to specify the underlying object type for data type mapping
const getTypeHint = val =>
  isDate(val) ? 'TIMESTAMP' : undefined

const isDate = val =>
  val instanceof Date

// Creates a standard Data API parameter using the supplied inputs
const formatType = (name,value,type,typeHint,formatOptions) => {
  return Object.assign(
    typeHint != null ? { name, typeHint } : { name },
    type === null ? { value }
    : {
      value: {
        [type ? type : error(`'${name}' is an invalid type`)]
        : type === 'isNull' ? true
        : isDate(value) ? formatToTimeStamp(value, formatOptions && formatOptions.treatAsLocalDate)
        : value
      }
    }
  )
} // end formatType

// Formats the (UTC) date to the AWS accepted YYYY-MM-DD HH:MM:SS[.FFF] format
// See https://docs.aws.amazon.com/rdsdataservice/latest/APIReference/API_SqlParameter.html
const formatToTimeStamp = (date, treatAsLocalDate) => {
  const pad = (val,num=2) => '0'.repeat(num-(val + '').length) + val

  const year = treatAsLocalDate ? date.getFullYear() : date.getUTCFullYear()
  const month = (treatAsLocalDate ? date.getMonth() : date.getUTCMonth()) + 1 // Convert to human month
  const day = treatAsLocalDate ? date.getDate() : date.getUTCDate()

  const hours = treatAsLocalDate ? date.getHours() : date.getUTCHours()
  const minutes = treatAsLocalDate ? date.getMinutes() : date.getUTCMinutes()
  const seconds = treatAsLocalDate ? date.getSeconds() : date.getUTCSeconds()
  const ms = treatAsLocalDate ? date.getMilliseconds() : date.getUTCMilliseconds()

  const fraction = ms <= 0 ? '' : `.${pad(ms,3)}`

  return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}${fraction}`
}

// Converts the string value to a Date object.
// If standard TIMESTAMP format (YYYY-MM-DD[ HH:MM:SS[.FFF]]) without TZ + treatAsLocalDate=false then assume UTC Date
// In all other cases convert value to datetime as-is (also values with TZ info)
const formatFromTimeStamp = (value,treatAsLocalDate) =>
  !treatAsLocalDate && /^\d{4}-\d{2}-\d{2}(\s\d{2}:\d{2}:\d{2}(\.\d{3})?)?$/.test(value) ?
    new Date(value + 'Z') :
    new Date(value)

// Formats the results of a query response
const formatResults = (
  { // destructure results
    columnMetadata, // ONLY when hydrate or includeResultMetadata is true
    numberOfRecordsUpdated, // ONLY for executeStatement method
    records, // ONLY for executeStatement method
    generatedFields, // ONLY for INSERTS
    updateResults // ONLY on batchExecuteStatement
  },
  hydrate,
  includeMeta,
  formatOptions
) => Object.assign(
  includeMeta ? { columnMetadata } : {},
  numberOfRecordsUpdated !== undefined && !records ? { numberOfRecordsUpdated } : {},
  records ? {
    records: formatRecords(records, columnMetadata, hydrate, formatOptions)
  } : {},
  updateResults ? { updateResults: formatUpdateResults(updateResults) } : {},
  generatedFields && generatedFields.length > 0 ?
    { insertId: generatedFields[0].longValue } : {}
)

// Processes records and either extracts Typed Values into an array, or
// object with named column labels
const formatRecords = (recs,columns,hydrate,formatOptions) => {

  // Create map for efficient value parsing
  let fmap = recs && recs[0] ? recs[0].map((x,i) => {
    return Object.assign({},
      columns ? { label: columns[i].label, typeName: columns[i].typeName } : {} ) // add column label and typeName
  }) : {}

  // Map over all the records (rows)
  return recs ? recs.map(rec => {

    // Reduce each field in the record (row)
    return rec.reduce((acc,field,i) => {

      // If the field is null, always return null
      if (field.isNull === true) {
        return hydrate ? // object if hydrate, else array
          Object.assign(acc,{ [fmap[i].label]: null })
          : acc.concat(null)

      // If the field is mapped, return the mapped field
      } else if (fmap[i] && fmap[i].field) {
        const value = formatRecordValue(field[fmap[i].field],fmap[i].typeName,formatOptions)
        return hydrate ? // object if hydrate, else array
          Object.assign(acc,{ [fmap[i].label]: value })
          : acc.concat(value)

      // Else discover the field type
      } else {

        // Look for non-null fields
        Object.keys(field).map(type => {
          if (type !== 'isNull' && field[type] !== null) {
            fmap[i]['field'] = type
          }
        })

        // Return the mapped field (this should NEVER be null)
        const value = formatRecordValue(field[fmap[i].field],fmap[i].typeName,formatOptions)
        return hydrate ? // object if hydrate, else array
          Object.assign(acc,{ [fmap[i].label]: value })
          : acc.concat(value)
      }

    }, hydrate ? {} : []) // init object if hydrate, else init array
  }) : [] // empty record set returns an array
} // end formatRecords

// Format record value based on its value, the database column's typeName and the formatting options
const formatRecordValue = (value,typeName,formatOptions) => formatOptions && formatOptions.deserializeDate &&
  ['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE'].includes(typeName)
  ? formatFromTimeStamp(value,(formatOptions && formatOptions.treatAsLocalDate) || typeName === 'TIMESTAMP WITH TIME ZONE')
  : value

// Format updateResults and extract insertIds
const formatUpdateResults = res => res.map(x => {
  return x.generatedFields && x.generatedFields.length > 0 ?
    { insertId: x.generatedFields[0].longValue } : {}
})

/********************************************************************/
/**  INSTANTIATION                                                 **/
/********************************************************************/

// Export main function
/**
 * Create a Data API codec instance
 * @param {object} params
 * @param {'mysql'|'pg'} [params.engine=mysql] The type of database (MySQL or Postgres)
 * @param {boolean} [params.hydrateColumnNames=true] Return objects with column
 *   names as keys
 * @param {object} [params.formatOptions] Date-related formatting options
 * @param {boolean} [params.formatOptions.deserializeDate=false]
 * @param {boolean} [params.formatOptions.treatAsLocalDate=false]
 *
 */
const init = (params = {}) => {

  // Set the configuration for this instance
  const config = {
    // Require engine
    engine: typeof params.engine === 'string' ?
      params.engine
      : 'mysql',

    // Set hydrateColumnNames (default to true)
    hydrateColumnNames:
      typeof params.hydrateColumnNames === 'boolean' ?
        params.hydrateColumnNames : true,

    // Value formatting options. For date the deserialization is enabled and (re)stored as UTC
    formatOptions: {
      deserializeDate:
        typeof params.formatOptions === 'object' && params.formatOptions.deserializeDate === false ? false : true,
      treatAsLocalDate:
        typeof params.formatOptions === 'object' && params.formatOptions.treatAsLocalDate
    },

  } // end config

  // Return public methods
  return {

    // Format parameters method, pass parameters
    formatParameters: (p) => processParams(config.engine, normalizeParams(parseParams([{ parameters: p }])), config.formatOptions).processedParams,

    // Format response method, pass response
    formatResponse: (r) => formatResults(r, config.hydrateColumnNames, r.columnMetadata, config.formatOptions),
  }

} // end exports

module.exports = init
