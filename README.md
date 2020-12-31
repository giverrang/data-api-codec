# Data API Codec

The **Data API Codec** is a lightweight utility that simplifies working with the Amazon Aurora Serverless Data API by abstracting away the notion of field values. This abstraction annotates native JavaScript types supplied as input parameters, as well as converts annotated response data to native JavaScript types.

For more information about the Aurora Serverless Data API, you can review the [official documentation](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html) or read [Aurora Serverless Data API: An (updated) First Look](https://www.jeremydaly.com/aurora-serverless-data-api-a-first-look/) for some more insights on performance.

## Simple Examples

The **Data API Codec** makes working with the Aurora Serverless Data API super simple. Require and instantiate the library with basic configuration information, then use the `formatParameters()` and `formatResponse()` methods. Below are some examples.

```javascript
// Require and instantiate data-api-codec
const codec = require('data-api-codec')()
const AWS = require('aws-sdk')

const data = new AWS.RDSDataService({ params: {
  resourceArn: '...',
  secretArn: '...',
  database: '...',
}})

/*** Assuming we're in an async function ***/

// Simple SELECT
let result = codec.formatResponse(await data.executeStatement({ sql: `SELECT * FROM myTable` }).promise())
// {
//   records: [
//     { id: 1, name: 'Alice', age: null },
//     { id: 2, name: 'Mike', age: 52 },
//     { id: 3, name: 'Carol', age: 50 }
//   ]
// }

// SELECT with named parameters
let resultParams = codec.formatResponse(await data.executeStatement({
    sql: `SELECT * FROM myTable WHERE id = :id`,
    parameters: codec.formatParameters({ id: 2 }),
}).promise())
// { records: [ { id: 2, name: 'Mike', age: 52 } ] }

// INSERT with named parameters
let insert = codec.formatResponse(await data.executeStatement({
    sql: `INSERT INTO myTable (name,age,has_curls) VALUES(:name,:age,:curls)`,
    parameters: codec.formatParameters({ name: 'Greg',   age: 18,  curls: false }),
}).promise())

// BATCH INSERT with named parameters
let batchInsert = codec.formatResponse(await data.batchExecuteStatement({
    sql: `INSERT INTO myTable (name,age,has_curls) VALUES(:name,:age,:curls)`,
    parameterSets: codec.formatParameters([
      [{ name: 'Marcia', age: 17,  curls: false }],
      [{ name: 'Peter',  age: 15,  curls: false }],
      [{ name: 'Jan',    age: 15,  curls: false }],
      [{ name: 'Cindy',  age: 12,  curls: true  }],
      [{ name: 'Bobby',  age: 12,  curls: false }]
    ]),
}).promise())

// Update with named parameters
let update = codec.formatResponse(await data.executeStatement({
    sql: `UPDATE myTable SET age = :age WHERE id = :id`,
    parameters: codec.formatParameters({ age: 13, id: 5 }),
}).promise())

// Delete with named parameters
let remove = codec.formatResponse(await data.executeStatement({
    sql: `DELETE FROM myTable WHERE name = :name`,
    parameters: codec.formatParameters({ name: 'Jan' }), // Sorry Jan :(
}).promise())
```

## Why do I need this?
The [Data API](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/data-api.html) requires you to specify data types when passing in parameters. The basic `INSERT` example above would look like this using the native `AWS.RDSDataService` class:

```javascript
const AWS = require('aws-sdk')
const data = new AWS.RDSDataService()

/*** Assuming we're in an async function ***/

// INSERT with named parameters
let insert = await data.executeStatement({
  secretArn: 'arn:aws:secretsmanager:us-east-1:XXXXXXXXXXXX:secret:mySecret',
  resourceArn: 'arn:aws:rds:us-east-1:XXXXXXXXXXXX:cluster:my-cluster-name',
  database: 'myDatabase',
  sql: 'INSERT INTO myTable (name,age,has_curls) VALUES(:name,:age,:curls)',
  parameters: [
    { name: 'name', value: { stringValue: 'Cousin Oliver' } },
    { name: 'age', value: { longValue: 10 } },
    { name: 'curls', value: { booleanValue: false } }
  ]
).promise()
```

Specifying all of those data types in the parameters is a bit clunky. In addition to requiring types for parameters, it also returns each field as an object with its value assigned to a key that represents its data type, like this:

```javascript
{ // id field
  "longValue": 9
},
{ // name field
  "stringValue": "Cousin Oliver"
},
{ // age field
  "longValue": 10
},
{ // has_curls field
  "booleanValue": false
}
```
Not only are there no column names, but you have to pull the value from the data type field. Lots of extra work that the **Data API Codec** handles automatically for you. 😀

## Installation and Setup
```
npm i data-api-codec
```

For more information on enabling Data API, see [Enabling Data API](#enabling-data-api).

## Configuration Options

Below is a table containing all of the possible configuration options for the `data-api-codec`. Additional details are provided throughout the documentation.

| Property | Type | Description | Default |
| -------- | ---- | ----------- | ------- |
| engine | `mysql` or `pg` | The type of database engine you're connecting to (MySQL or Postgres). | `mysql` |
| hydrateColumnNames | `boolean` | When `true`, results will be returned as objects with column names as keys. If `false`, results will be returned as an array of values. | `true` |
| formatOptions | `object`  | Formatting options to auto parse dates and coerce native JavaScript date objects to MySQL supported date formats. Valid keys are `deserializeDate` and `treatAsLocalDate`. Both accept boolean values. | Both `false` |

## How to use this module

To use the Data API Codec, require the module and instantiate it with your [Configuration options](#configuration-options). If you are using it with AWS Lambda, require it **OUTSIDE** your main handler function. This will allow you to reuse the initialized module on subsequent invocations.

```javascript
// Require and instantiate data-api-codec
const data = require('data-api-codec')({
  engine: 'pg', // use PostgreSQL
})
```
### Formatting Responses
Once initialized, formatting the response of a query is super simple. Use the `formatResponse()` method and pass in the results of your Data API call:

```javascript
let result = codec.formatResponse(await data.executeStatement({
    sql: `SELECT * FROM myTable`,
}).promise())
```

By default, this will return your rows as an array of objects with column names as property names:
```javascript
[
  { id: 1, name: 'Alice', age: null },
  { id: 2, name: 'Mike', age: 52 },
  { id: 3, name: 'Carol', age: 50 }
]
```

### Formatting Parameters
You can use named parameters in your SQL, and then format the parameters using the `formatParameters()` method:

```javascript
await data.executeStatement({
    sql: `INSERT INTO myTable (name,age) VALUES(:name,:age)`,
    parameters: codec.formatParameters({ name: 'Greg', age: 18 }),
}).promise()
```

The Data API Codec will convert your parameters into the correct Data API parameter format using native JavaScript types. If you prefer to use the clunky format, or you need more control over the data type, you can just pass in the `RDSDataService` format:

```javascript
await data.executeStatement({
    sql: `INSERT INTO myTable (id,name) VALUES(:id,:name)`,
    parameters: codec.formatParameters([
      // An array of objects is totally cool, too. We'll merge them for you.
      { id: 2 },
      // Data API Codec just passes this straight on through
      { name: 'createDate', value: { blobValue: new Buffer('2019-06-01') } }
    ]),
}).promise()
```

### Formatting Batch Parameters
The `RDSDataService` Class provides a `batchExecuteStatement` method that allows you to execute a prepared statement multiple times using different parameter sets. This is only allowed for `INSERT`, `UPDATE` and `DELETE` queries, but is much more efficient than issuing multiple `executeStatement` calls. The Data API Codec formats parameters appropriately based on *how* you send in your parameters.

To format parameters for a batch query, use the `formatParmeters()` method, and provide multiple parameter sets as nested arrays. For example, if you wanted to update multiple records at once, your query might look like this:

```javascript
await data.executeStatement({
    sql: `UPDATE myTable SET name = :newName WHERE id = :id`,
    parameters: codec.formatParameters([
      [ { id: 1, newName: 'Alice Franklin' } ],
      [ { id: 7, newName: 'Jan Glass' } ]
    ]),
}).promise()
```

### Retrieving Insert IDs
The Data API returns a `generatedFields` array that contains the value of auto-incrementing primary keys. If this value is returned, the Data API codec will parse this and return it as the `insertId`. This also works for batch queries as well.

## Data API Limitations / Wonkiness
The first GA release of the Data API has *a lot* of promise, unfortunately, there are still quite a few things that make it a bit wonky and may require you to implement some workarounds. I've outlined some of my findings below.

### You can't send in an array of values
The GitHub repo for RDSDataService mentions something about `arrayValues`, but I've been unable to get arrays (including TypedArrays and Buffers) to be used for parameters with `IN` clauses. For example, the following query will **NOT** work:

```javascript
let result = await data.executeStatement({
  secretArn: 'arn:aws:secretsmanager:us-east-1:XXXXXXXXXXXX:secret:mySecret',
  resourceArn: 'arn:aws:rds:us-east-1:XXXXXXXXXXXX:cluster:my-cluster-name',
  database: 'myDatabase',
  sql: 'SELECT * FROM myTable WHERE id IN (:ids)',
  parameters: [
    { name: 'id', value: { blobValue: [1,2,3,4,5] } }
  ]
).promise()
```

I'm using `blobValue` because it's the only generic value field. You could send it in as a string, but then it only uses the first value. Hopefully they will add an `arrayValues` or something similar to support this in the future.

### ~~Named parameters MUST be sent in order~~
~~Read that again if you need to. So parameters have to be **BOTH** named and *in order*, otherwise the query **may** fail. I stress **may**, because if you send in two fields of compatible type in the wrong order, the query will work, just with your values flipped. 🤦🏻‍♂️ Watch out for this one.~~ 👈This was fixed!

### Batch statements do not give you updated record counts
This one is a bit frustrating. If you execute a standard `executeStatement`, then it will return a `numberOfRecordsUpdated` field for `UPDATE` and `DELETE` queries. This is handy for knowing if your query succeeded. Unfortunately, a `batchExecuteStatement` does not return this field for you.

## Enabling Data API
In order to use the Data API, you must enable it on your Aurora Serverless Cluster and create a Secret. You also musst grant your execution environment a number of permission as outlined in the following sections.

### Enable Data API on your Aurora Serverless Cluster

![Enable Data API in Network & Security settings of your cluster](https://user-images.githubusercontent.com/2053544/58768968-79ee4300-8570-11e9-9266-1433182e0db2.png)

You need to modify your Aurora Serverless cluster by clicking “ACTIONS” and then “Modify Cluster”. Just check the Data API box in the *Network & Security* section and you’re good to go. Remember that your Aurora Serverless cluster still runs in a VPC, even though you don’t need to run your Lambdas in a VPC to access it via the Data API.

### Set up a secret in the Secrets Manager

Next you need to set up a secret in the Secrets Manager. This is actually quite straightforward. User name, password, encryption key (the default is probably fine for you), and select the database you want to access with the secret.

![Enter database credentials and select database to access](https://user-images.githubusercontent.com/2053544/58768974-912d3080-8570-11e9-8878-636dfb742b00.png)


Next we give it a name, this is important, because this will be part of the arn when we set up permissions later. You can give it a description as well so you don’t forget what this secret is about when you look at it in a few weeks.

![Give your secret a name and add a description](https://user-images.githubusercontent.com/2053544/58768984-a7d38780-8570-11e9-8b21-199db5548c73.png)

You can then configure your rotation settings, if you want, and then you review and create your secret. Then you can click on your newly created secret and grab the arn, we’re gonna need that next.

![Click on your secret to get the arn.](https://user-images.githubusercontent.com/2053544/58768989-bae65780-8570-11e9-94fb-51f6fa7d34bf.png)

### Required Permissions

In order to use the Data API, your execution environment requires several IAM permissions. Below are the minimum permissions required. **Please Note:** The `Resource: "*"` permission for `rds-data` is recommended by AWS (see [here](https://docs.aws.amazon.com/IAM/latest/UserGuide/list_amazonrdsdataapi.html#amazonrdsdataapi-resources-for-iam-policies)) because Amazon RDS Data API does not support specifying a resource ARN. The credentials specified in Secrets Manager can be used to restrict access to specific databases.

**YAML:**
```yaml
Statement:
  - Effect: "Allow"
    Action:
      - "rds-data:ExecuteSql"
      - "rds-data:ExecuteStatement"
      - "rds-data:BatchExecuteStatement"
      - "rds-data:BeginTransaction"
      - "rds-data:RollbackTransaction"
      - "rds-data:CommitTransaction"
    Resource: "*"
  - Effect: "Allow"
    Action:
      - "secretsmanager:GetSecretValue"
    Resource: "arn:aws:secretsmanager:{REGION}:{ACCOUNT-ID}:secret:{PATH-TO-SECRET}/*"
```

**JSON:**
```javascript
"Statement" : [
  {
    "Effect": "Allow",
    "Action": [
      "rds-data:ExecuteSql",
      "rds-data:ExecuteStatement",
      "rds-data:BatchExecuteStatement",
      "rds-data:BeginTransaction",
      "rds-data:RollbackTransaction",
      "rds-data:CommitTransaction"
    ],
    "Resource": "*"
  },
  {
    "Effect": "Allow",
    "Action": [ "secretsmanager:GetSecretValue" ],
    "Resource": "arn:aws:secretsmanager:{REGION}:{ACCOUNT-ID}:secret:{PATH-TO-SECRET}/*"
  }
]
```

## Contributions
Contributions, ideas and bug reports are welcome and greatly appreciated. Please add [issues](https://github.com/giverrang/data-api-codec/issues) for suggestions and bug reports or create a pull request.

## Attribution
This repository is a fork of https://github.com/jeremydaly/data-api-client with all the dependencies removed and the wrapper functionality stripped out. Thank you to [Jeremy Daly](https://github.com/jeremydaly) for [data-api-client](https://github.com/jeremydaly/data-api-client)!
